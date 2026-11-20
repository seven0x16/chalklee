import { readChalkLeeFixture } from "../../../test-fixtures/documents";
import { validateChalkLeeSemantics, type ChalkLeeDocument, type ChalkLeeRootNode } from "@chalklee/format";
import { getSchema, type Extensions } from "@tiptap/core";
import { TextStyle } from "@tiptap/extension-text-style";
import { joinBackward, splitBlock } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, NodeSelection, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChalkLeeBlankNode, ChalkLeeBlockMathNode, ChalkLeeDocumentNode, ChalkLeeHeadingNode, ChalkLeeImageNode, ChalkLeeInlineMathNode, ChalkLeePageBreakNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeOptionAuthoringExtension } from "./extensions/optionAuthoring";
import { ChalkLeeQuestionRegionAuthoringExtension } from "./extensions/regionAuthoring";
import { ChalkLeeStableIdExtension, chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeTableCellNode, ChalkLeeTableNode, ChalkLeeTableRowNode } from "./extensions/tableNodes";
import { isChalkLeeOptionMarkerSpaceKey } from "./extensions/optionMarkers";
import { matchChalkLeeQuestionNumberMarkerInput, matchChalkLeeQuestionStemNumberPrefix } from "./extensions/authoringShared";
import { createEmptyChalkLeeDocument, sanitizeChalkLeeEditorJson } from "./editing";
import { chalkLeePristineBodySelectionPosition } from "./editorWorkflow";
import { chalkLeeQuestionRegionTransaction } from "./editorContext";
import { chalkLeeAddOptionTransaction } from "./extensions/questionCommands";
import { chalkLeeQuestionFieldTabTransaction } from "./questionFieldKeyboard";
import { chalkLeeActiveBlockStyle, chalkLeeCanSetBlockStyle, chalkLeeSetBlockStyleTransaction, chalkLeeToggleListTransaction } from "./numberedBlocks";

const ChalkLeeTestTextStyle = TextStyle.extend({
  addAttributes: () => ({ fontSizePt: { default: null } })
});

const schema = getSchema([
  StarterKit.configure({
    document: false,
    paragraph: false,
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    link: false,
    trailingNode: false
  }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeHeadingNode,
  ChalkLeeImageNode,
  ChalkLeeBlockMathNode,
  ChalkLeeInlineMathNode,
  ChalkLeeBlankNode,
  ChalkLeePageBreakNode,
  ChalkLeeTableNode,
  ChalkLeeTableRowNode,
  ChalkLeeTableCellNode,
  ...chalkLeeStructuralExtensions,
  ChalkLeeTestTextStyle
] as Extensions);

const mathGoldenContent = (readChalkLeeFixture("math-exam") as ChalkLeeDocument).content;

interface OptionAuthoringStorage {
  physicalSpacePending: boolean;
  composing: boolean;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RegionAuthoringStorage {
  composing: boolean;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingParagraphId: string | null;
  pendingTarget: "questionAnswer" | "questionAnalysis" | null;
}

interface FreeAuthoringHarness {
  view: EditorView;
  optionPlugin: Plugin;
  regionPlugin: Plugin;
  state(): EditorState;
  dispatch(transaction: Transaction): void;
  setComposing(value: boolean): void;
  dispatchBatches: Array<readonly Transaction[]>;
  undo(): boolean;
  redo(): boolean;
}

describe("ChalkLee free-flow question authoring", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("matches only exact physical-space number syntax and a separated numbered stem", () => {
    expect(matchChalkLeeQuestionNumberMarkerInput("1. ", true)).toMatchObject({ number: 1 });
    expect(matchChalkLeeQuestionNumberMarkerInput("１２． ", true)).toMatchObject({ number: 12 });
    expect(matchChalkLeeQuestionNumberMarkerInput("9）　", true)).toMatchObject({ number: 9 });
    expect(matchChalkLeeQuestionStemNumberPrefix("1. 求方程的解")).toEqual({ number: 1, prefixSize: 3 });
    expect(matchChalkLeeQuestionStemNumberPrefix("２、 已知条件")).toEqual({ number: 2, prefixSize: 3 });
    expect(isChalkLeeOptionMarkerSpaceKey(plainKey("Space"))).toBe(true);

    for (const unsafe of ["0. ", "01. ", "1000. ", "1.5 ", "-1. ", "1.  ", "1.正文 "]) {
      expect(matchChalkLeeQuestionNumberMarkerInput(unsafe, true)).toBeNull();
    }
    expect(matchChalkLeeQuestionNumberMarkerInput("1. ", false)).toBeNull();
    expect(matchChalkLeeQuestionStemNumberPrefix("1. ")).toBeNull();
    expect(isChalkLeeOptionMarkerSpaceKey(spaceKey({ repeat: true }))).toBe(false);
  });

  it("selects only the untouched default body paragraph as the initial editing target", () => {
    const pristine = pristineDocument();
    expect(chalkLeePristineBodySelectionPosition(pristine)).toBe(pristine.firstChild!.nodeSize + 1);

    const heading = pristine.firstChild!;
    const body = pristine.lastChild!;
    const changedHeading = schema.nodes.heading.create(
      { ...heading.attrs, textAlign: "left" },
      heading.content,
      heading.marks
    );
    expect(chalkLeePristineBodySelectionPosition(schema.nodes.doc.create(null, [changedHeading, body]))).toBeNull();
    expect(chalkLeePristineBodySelectionPosition(schema.nodes.doc.create(null, [
      heading.type.create(heading.attrs, schema.text("旧试卷"), heading.marks),
      body
    ]))).toBeNull();
    expect(chalkLeePristineBodySelectionPosition(schema.nodes.doc.create(null, [
      heading,
      paragraph("body", "已有正文")
    ]))).toBeNull();
    expect(chalkLeePristineBodySelectionPosition(schema.nodes.doc.create(null, [
      heading,
      paragraph("body", "", { textAlign: "center" })
    ]))).toBeNull();
    expect(chalkLeePristineBodySelectionPosition(schema.nodes.doc.create(null, [
      heading,
      body,
      paragraph("extra")
    ]))).toBeNull();
  });

  it("turns a pristine root `1. ` into a minimal automatic question with real history and StableId append", () => {
    const initial = schema.nodes.doc.create(null, [
      titleHeading(),
      paragraph("first_stem", "1.")
    ]);
    const harness = freeAuthoringHarness(initial, "first_stem");

    expect(typePhysicalSpace(harness)).toBe(true);
    expect(topLevelTypes(harness.state().doc)).toEqual(["heading", "question", "paragraph"]);
    expect(harness.dispatchBatches).toHaveLength(3);
    expect(harness.dispatchBatches[1]).toHaveLength(2);

    const first = topLevelQuestions(harness.state().doc)[0];
    expect(first.attrs.kind).toBe("free-response");
    expect(first.attrs.number).toEqual({ mode: "auto" });
    expect(first.content.content.map((node) => node.type.name)).toEqual(["questionStem"]);
    expect(first.firstChild?.firstChild?.attrs.id).toBe("first_stem");
    expect(first.textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe("first_stem");
    expect(allIdsAreUnique(harness.state().doc)).toBe(true);
    expectValidChalkLee(harness.state().doc);

    harness.dispatch(harness.state().tr.insertText("已知 x+1=3，求 x"));
    expect(firstQuestionStemText(harness.state().doc)).toBe("已知 x+1=3，求 x");

    expect(harness.undo()).toBe(true);
    expect(firstQuestionStemText(harness.state().doc)).toBe("");
    expect(harness.undo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(findNodeById(harness.state().doc, "first_stem")?.node.textContent).toBe("1. ");
    expect(harness.undo()).toBe(true);
    expect(findNodeById(harness.state().doc, "first_stem")?.node.textContent).toBe("1.");

    expect(harness.redo()).toBe(true);
    expect(findNodeById(harness.state().doc, "first_stem")?.node.textContent).toBe("1. ");
    expect(harness.redo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.redo()).toBe(true);
    expect(firstQuestionStemText(harness.state().doc)).toBe("已知 x+1=3，求 x");
  });

  it("turns a pristine root `21. ` into a fixed question and Backspace restores the complete marker", () => {
    const initial = schema.nodes.doc.create(null, [
      titleHeading(),
      paragraph("fixed_21_marker", "21.")
    ]);
    const harness = freeAuthoringHarness(initial, "fixed_21_marker");

    typeNativePhysicalSpace(harness);

    expect(topLevelTypes(harness.state().doc)).toEqual(["heading", "question", "paragraph"]);
    const question = topLevelQuestions(harness.state().doc)[0];
    expect(question.attrs).toMatchObject({
      kind: "free-response",
      number: { mode: "fixed", label: "21" }
    });
    expect(question.content.content.map((node) => node.type.name)).toEqual(["questionStem"]);
    expect(question.firstChild?.firstChild?.attrs.id).toBe("fixed_21_marker");
    expect(question.textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe("fixed_21_marker");

    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(harness.state().doc.lastChild?.type.name).toBe("paragraph");
    expect(harness.state().doc.lastChild?.attrs.id).toBe("fixed_21_marker");
    expect(harness.state().doc.lastChild?.textContent).toBe("21. ");
    expect(harness.state().selection.from).toBe(harness.state().selection.$from.end());
    expectValidChalkLee(harness.state().doc);
  });

  it("lets Backspace undo a question recognized directly on the `21.` terminator", () => {
    const initial = schema.nodes.doc.create(null, [titleHeading(), paragraph("fixed_21_dot", "21")]);
    const harness = freeAuthoringHarness(initial, "fixed_21_dot");

    typeNativeText(harness, ".");
    expect(topLevelQuestions(harness.state().doc)[0]?.attrs.number).toEqual({ mode: "fixed", label: "21" });
    expect(firstQuestionStemText(harness.state().doc)).toBe("");

    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(findNodeById(harness.state().doc, "fixed_21_dot")?.node.textContent).toBe("21.");
    expectValidChalkLee(harness.state().doc);
  });

  it("recognizes physical `2`, `1`, `.` typing in the pristine body created by the real new-document factory", () => {
    let id = 0;
    const document = createEmptyChalkLeeDocument(
      "从零录题",
      () => `factory_21_${++id}`,
      "2026-09-04T00:00:00.000Z"
    );
    const initial = schema.nodeFromJSON(document.content);
    const bodyId = String(initial.lastChild?.attrs.id);
    const harness = freeAuthoringHarness(initial, bodyId);

    typeNativeKeyboardText(harness, "2");
    expect(harness.state().selection.$from.parent.textContent).toBe("2");
    typeNativeKeyboardText(harness, "1");
    expect(harness.state().selection.$from.parent.textContent).toBe("21");
    typeNativeKeyboardText(harness, ".");

    const questions = topLevelQuestions(harness.state().doc);
    expect(questions).toHaveLength(1);
    expect(questions[0].attrs.number).toEqual({ mode: "fixed", label: "21" });
    expect(questions[0].firstChild?.firstChild?.attrs.id).toBe(bodyId);
    expect(questions[0].textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe(bodyId);
    expectValidChalkLee(harness.state().doc);
  });

  it("recognizes an exact `21.` marker committed as one native text-input chunk", () => {
    const markerId = "chunked_question_21_marker";
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph(markerId)]),
      markerId
    );
    const position = harness.state().selection.from;

    expect(handleOptionKeyDown(harness, plainKey(".") as KeyboardEvent)).toBe(false);
    expect(handleOptionTextInput(harness, position, position, "21.")).toBe(true);

    const question = topLevelQuestions(harness.state().doc)[0];
    expect(question?.attrs.number).toEqual({ mode: "fixed", label: "21" });
    expect(question?.firstChild?.firstChild?.attrs.id).toBe(markerId);
    expect(question?.textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe(markerId);
    expectValidChalkLee(harness.state().doc);
  });

  it("recognizes physical `21.` as the next automatic question after twenty structured questions", () => {
    const priorQuestions = Array.from({ length: 20 }, (_, index) => minimalQuestion(
      `direct_prior_${index + 1}`,
      `direct_prior_${index + 1}_body`,
      `第 ${index + 1} 题`
    ));
    const markerId = "direct_question_21_marker";
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), ...priorQuestions, paragraph(markerId)]),
      markerId
    );

    typeNativeKeyboardText(harness, "21.");

    const questions = topLevelQuestions(harness.state().doc);
    expect(questions).toHaveLength(21);
    expect(questions[20].attrs.number).toEqual({ mode: "auto" });
    expect(questions[20].firstChild?.firstChild?.attrs.id).toBe(markerId);
    expect(questions[20].textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe(markerId);
    expectValidChalkLee(harness.state().doc);
  });

  it("defaults to a list after the loaded answer-image appendix, with explicit question correction", () => {
    const markerId = "loaded_golden_question_21_marker";
    const loaded = schema.nodeFromJSON({
      ...mathGoldenContent,
      content: [
        ...(mathGoldenContent.content ?? []),
        { type: "paragraph", attrs: { id: markerId } }
      ]
    });
    const harness = freeAuthoringHarness(loaded, markerId);

    expect(topLevelQuestions(harness.state().doc)).toHaveLength(20);
    typeNativeKeyboardText(harness, "21.");

    expect(topLevelQuestions(harness.state().doc)).toHaveLength(20);
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: 21 });
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "question")!);
    const questions = topLevelQuestions(harness.state().doc);
    expect(questions).toHaveLength(21);
    expect(questions[20].attrs.number).toEqual({ mode: "fixed", label: "21" });
    expect(questions[20].firstChild?.firstChild?.attrs.id).toBe(markerId);
    expect(questions[20].textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe(markerId);
    expect(allIdsAreUnique(harness.state().doc)).toBe(true);
  });

  it("recovers the literal `21.` line in the archived Round3 tail when the teacher retypes its dot", () => {
    const priorQuestions = Array.from({ length: 20 }, (_, index) => minimalQuestion(
      `round3_prior_${index + 1}`,
      `round3_prior_${index + 1}_body`,
      `第 ${index + 1} 题`
    ));
    const markerId = "round3_literal_21";
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [
        titleHeading(),
        ...priorQuestions,
        paragraph("round3_blank_1"),
        paragraph("round3_blank_2"),
        paragraph("round3_blank_3"),
        paragraph(markerId, "21"),
        paragraph("round3_literal_option", "A.s s"),
        paragraph("round3_tail")
      ]),
      markerId
    );

    typeNativeKeyboardText(harness, ".");

    const questions = topLevelQuestions(harness.state().doc);
    expect(questions).toHaveLength(21);
    expect(questions[20].attrs.number).toEqual({ mode: "auto" });
    expect(questions[20].firstChild?.firstChild?.attrs.id).toBe(markerId);
    expect(harness.state().selection.$from.parent.attrs.id).toBe(markerId);
    expect(findNodeById(harness.state().doc, "round3_literal_option")?.node.textContent).toBe("A.s s");
  });

  it("makes an internal body list when a later structured question exists", () => {
    const markerId = "middle_number_before_structure";
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [
        titleHeading(),
        minimalQuestion("prior_structure", "prior_structure_body", "第一题"),
        paragraph(markerId, "2"),
        paragraph("middle_plain_tail", "普通说明"),
        minimalQuestion("later_structure", "later_structure_body", "后一道结构题"),
        paragraph("after_later_structure")
      ]),
      markerId
    );

    typeNativeKeyboardText(harness, ".");

    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
    expect(findNodeById(harness.state().doc, markerId)?.node.attrs).toMatchObject({ listType: "ordered", listStart: 2 });
    expect(harness.state().selection.$from.parent.attrs.id).toBe(markerId);
  });

  it("makes an out-of-sequence root marker a list before an ordinary authoring tail", () => {
    const markerId = "tail_skipped_number";
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [
        titleHeading(),
        minimalQuestion("tail_prior_question", "tail_prior_body", "第一题"),
        paragraph(markerId, "5"),
        paragraph("tail_plain_content", "普通尾部内容"),
        paragraph("tail_plain_empty")
      ]),
      markerId
    );

    typeNativeKeyboardText(harness, ".");

    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(findNodeById(harness.state().doc, markerId)?.node.attrs).toMatchObject({ listType: "ordered", listStart: 5 });
    expect(harness.state().selection.$from.parent.attrs.id).toBe(markerId);
  });

  it("writes a choice question with the option and analysis buttons, Tab and the next number", () => {
    const initial = schema.nodes.doc.create(null, [
      titleHeading(),
      paragraph("physical_flow", "1.")
    ]);
    const harness = freeAuthoringHarness(initial, "physical_flow");

    typeNativePhysicalSpace(harness);
    typeNativeText(harness, "若 x²-5x+6=0，则 x 的值为");
    // Typed option markers stay in the stem as text.
    pressNativeEnter(harness);
    typeNativeText(harness, "A. 不是选项");
    expect(topLevelQuestions(harness.state().doc)[0].content.content.map(node => node.type.name)).toEqual(["questionStem"]);
    expect(topLevelQuestions(harness.state().doc)[0].firstChild?.lastChild?.textContent).toBe("A. 不是选项");
    const literal = harness.state().selection.$from;
    harness.dispatch(harness.state().tr.delete(literal.before() - 1, literal.after()));
    expect(topLevelQuestions(harness.state().doc)[0].firstChild?.childCount).toBe(1);

    const questionId = String(topLevelQuestions(harness.state().doc)[0].attrs.id);
    harness.dispatch(chalkLeeAddOptionTransaction(harness.state(), questionId)!);
    expect(harness.state().selection.$from.node(-1).attrs.label).toBe("A");
    typeNativeText(harness, "1 或 6");
    // Enter and Backspace stay inside the option: a new line in A, then joined back.
    pressNativeEnter(harness);
    expect(harness.state().selection.$from.node(-1).attrs.label).toBe("A");
    expect(harness.state().selection.$from.node(-1).childCount).toBe(2);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(false);
    expect(joinBackward(harness.state(), harness.dispatch)).toBe(true);
    expect(harness.state().selection.$from.node(-1).childCount).toBe(1);
    // Tab moves on to the next option.
    for (const [label, text] of [["B", "2 或 3"], ["C", "-1 或 6"], ["D", "-2 或 -3"]]) {
      harness.dispatch(chalkLeeQuestionFieldTabTransaction(harness.state(), 1)!);
      expect(harness.state().selection.$from.node(-1).attrs.label).toBe(label);
      typeNativeText(harness, text);
    }
    // Backspace at the start of an option neither removes it nor leaves it.
    const d = harness.state().selection.$from;
    harness.dispatch(harness.state().tr.setSelection(TextSelection.create(harness.state().doc, d.start())));
    const beforeBackspace = harness.state().doc;
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(harness.state().doc.eq(beforeBackspace)).toBe(true);
    expect(harness.state().selection.$from.node(-1).attrs.label).toBe("D");

    harness.dispatch(chalkLeeQuestionRegionTransaction(harness.state(), questionId, "questionAnalysis")!);
    typeNativeText(harness, "因式分解即可。");
    // The next question starts on the line after this one.
    const after = harness.state().doc.child(2);
    setTextSelection(harness, String(after.attrs.id), 0);
    typeNativeKeyboardText(harness, "2.");
    typeNativePhysicalSpace(harness);

    const questions = topLevelQuestions(harness.state().doc);
    expect(questions).toHaveLength(2);
    expect(questions[0].attrs.kind).toBe("choice");
    expect(questions[0].content.content.map((node) => node.type.name)).toEqual([
      "questionStem",
      "optionGroup",
      "questionAnalysis"
    ]);
    expect(questions[0].child(1).content.content.map((node) => [node.attrs.label, node.textContent])).toEqual([["A", "1 或 6"], ["B", "2 或 3"], ["C", "-1 或 6"], ["D", "-2 或 -3"]]);
    expect(questions[0].child(2).textContent).toBe("因式分解即可。");
    expect(questions[1].attrs).toMatchObject({ kind: "free-response", number: { mode: "auto" } });
    expect(questions[1].firstChild?.firstChild?.attrs.id).toBe(harness.state().selection.$from.parent.attrs.id);
    expectValidChalkLee(harness.state().doc);
  });

  it("keeps Enter inside the analysis, however many times it is pressed", () => {
    const analysisBody = paragraph("leave_analysis_body", "因式分解即可。");
    const question = schema.nodes.question.create({ id: "leave_question", kind: "free-response", number: { mode: "auto" } }, [
      schema.nodes.questionStem.create({ id: "leave_stem" }, paragraph("leave_stem_body", "求方程的解。")),
      schema.nodes.questionAnalysis.create({ id: "leave_analysis" }, analysisBody)
    ]);
    const initial = schema.nodes.doc.create(null, [titleHeading(), question, paragraph("leave_root_tail")]);
    const harness = freeAuthoringHarness(initial, "leave_analysis_body");

    pressNativeEnter(harness);
    pressNativeEnter(harness);
    expect(harness.state().selection.$from.node(-1).type.name).toBe("questionAnalysis");
    expect(findNodeById(harness.state().doc, "leave_analysis")?.node.childCount).toBe(3);
    expect(harness.state().doc.lastChild?.attrs.id).toBe("leave_root_tail");
    expectValidChalkLee(harness.state().doc);
  });

  it.each([
    [1, null], [1, 1.8]
  ] as const)("starts the next question after %i Enter with line height %s and restores every paragraph on undo", (enters, lineHeight) => {
    const analysisBody = paragraph("flow_analysis_body", "因式分解即可。", { lineHeight });
    const question = schema.nodes.question.create({ id: "flow_question", kind: "free-response", number: { mode: "auto" } }, [
      schema.nodes.questionStem.create({ id: "flow_stem" }, paragraph("flow_stem_body", "求方程的解。")),
      schema.nodes.questionAnswer.create({ id: "flow_answer" }, paragraph("flow_answer_body", "2 或 3")),
      schema.nodes.questionAnalysis.create({ id: "flow_analysis" }, analysisBody)
    ]);
    const initial = schema.nodes.doc.create(null, [titleHeading(), question, paragraph("flow_root_tail")]);
    const harness = freeAuthoringHarness(initial, "flow_analysis_body");
    for (let index = 0; index < enters; index += 1) pressNativeEnter(harness);
    const markerId = harness.state().selection.$from.parent.attrs.id;
    typeNativeKeyboardText(harness, "2.");

    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
    expect(harness.state().selection.$from.node(2).type.name).toBe("questionStem");
    const retainedAnalysis = findNodeById(harness.state().doc, "flow_analysis")!.node;
    expect(retainedAnalysis.firstChild?.eq(analysisBody)).toBe(true);
    expect(retainedAnalysis.childCount).toBe(lineHeight === null ? 1 : enters);
    expect(harness.undo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(findNodeById(harness.state().doc, "flow_analysis")?.node.childCount).toBe(enters + 1);
    expect(findNodeById(harness.state().doc, markerId)?.node.textContent).toBe("2.");
    expect(harness.redo()).toBe(true);
    typeNativeText(harness, "计算 3 + 4。");
    expect(topLevelQuestions(harness.state().doc)[1].firstChild?.textContent).toBe("计算 3 + 4。");
    expect(questionRegionText(harness.state().doc, "questionAnswer")).toBe("2 或 3");
    expectValidChalkLee(harness.state().doc);
  });

  it("cancels an auto-created empty question without consuming any of its marker", () => {
    const priorQuestions = Array.from({ length: 20 }, (_, index) => minimalQuestion(
      `prior_${index + 1}`,
      `prior_${index + 1}_body`,
      `第 ${index + 1} 题`
    ));
    const initial = schema.nodes.doc.create(null, [
      ...priorQuestions,
      paragraph("question_21_marker", "21.")
    ]);
    const harness = freeAuthoringHarness(initial, "question_21_marker");

    typeNativePhysicalSpace(harness);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(21);
    expect(harness.state().selection.$from.parent.textContent).toBe("");

    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(20);
    expect(harness.state().selection).toBeInstanceOf(TextSelection);
    expect(harness.state().doc.lastChild?.type.name).toBe("paragraph");
    expect(harness.state().doc.lastChild?.attrs.id).toBe("question_21_marker");
    expect(harness.state().doc.lastChild?.textContent).toBe("21. ");
    expect(harness.state().selection.from).toBe(harness.state().selection.$from.end());
    expectValidChalkLee(harness.state().doc);

    expect(harness.redo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(21);
    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.lastChild?.textContent).toBe("21. ");

    const end = harness.state().selection.from;
    harness.dispatch(harness.state().tr.delete(end - 1, end));
    expect(harness.state().doc.lastChild?.textContent).toBe("21.");
  });

  it("restores the teacher's exact full-width number marker when Backspace exits the question", () => {
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph("full_width_marker", "１）")]),
      "full_width_marker"
    );

    typeNativePhysicalSpace(harness);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(harness.state().doc.lastChild?.textContent).toBe("１） ");
    expect(harness.state().doc.lastChild?.attrs.id).toBe("full_width_marker");
  });

  it("keeps a written question on stem-start Backspace and deletes a selected one with Backspace", () => {
    const target = minimalQuestion("keyboard_delete", "keyboard_delete_body", "需要保留确认的题干");
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), target, paragraph("after_keyboard_delete", "后续内容")]),
      "keyboard_delete_body"
    );
    setTextSelection(harness, "keyboard_delete_body", 0);
    const beforeBackspace = harness.state().doc;

    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(harness.state().doc.eq(beforeBackspace)).toBe(true);
    expect(harness.state().selection.$from.parent.attrs.id).toBe("keyboard_delete_body");

    selectQuestion(harness, "keyboard_delete");
    expectSelectedQuestion(harness, "keyboard_delete");

    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(findNodeById(harness.state().doc, "keyboard_delete")).toBeNull();
    expect(findNodeById(harness.state().doc, "after_keyboard_delete")?.node.textContent).toBe("后续内容");
    expectValidChalkLee(harness.state().doc);
  });

  it("deletes a selected complete choice-and-answer question with Delete", () => {
    const target = completeChoiceQuestion("complete_keyboard_delete");
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), target, paragraph("after_complete_delete", "后续内容")]),
      "complete_keyboard_delete_stem_body"
    );
    setTextSelection(harness, "complete_keyboard_delete_stem_body", 0);
    const beforeSelection = harness.state().doc;

    selectQuestion(harness, "complete_keyboard_delete");
    expect(harness.state().doc.eq(beforeSelection)).toBe(true);
    expectSelectedQuestion(harness, "complete_keyboard_delete");
    expect((harness.state().selection as NodeSelection).node.content.content.map((node) => node.type.name)).toEqual([
      "questionStem", "optionGroup", "questionAnswer", "questionAnalysis"
    ]);

    expect(handleRegionKeyDown(harness, plainKey("Delete") as KeyboardEvent)).toBe(true);
    expect(findNodeById(harness.state().doc, "complete_keyboard_delete")).toBeNull();
    expect(findNodeById(harness.state().doc, "after_complete_delete")?.node.textContent).toBe("后续内容");
    expectValidChalkLee(harness.state().doc);
  });

  it("deletes and restores a complete choice question after a save/reopen round trip", () => {
    const target = completeChoiceQuestion("reopened_complete_delete");
    const persisted = sanitizeChalkLeeEditorJson(schema.nodes.doc.create(null, [
      titleHeading(),
      target,
      paragraph("after_reopened_complete_delete", "后续内容")
    ]).toJSON());
    const reopenedDoc = schema.nodeFromJSON(persisted);
    const harness = freeAuthoringHarness(reopenedDoc, "reopened_complete_delete_stem_body");
    setTextSelection(harness, "reopened_complete_delete_stem_body", 0);
    const beforeDelete = harness.state().doc.toJSON();

    selectQuestion(harness, "reopened_complete_delete");
    expectSelectedQuestion(harness, "reopened_complete_delete");
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(findNodeById(harness.state().doc, "reopened_complete_delete")).toBeNull();
    expect(findNodeById(harness.state().doc, "after_reopened_complete_delete")?.node.textContent).toBe("后续内容");
    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.toJSON()).toEqual(beforeDelete);
    expectValidChalkLee(harness.state().doc);
  });

  it("only takes away the indent of a non-first stem paragraph, staying in the stem", () => {
    const question = schema.nodes.question.create(
      { id: "nonfirst_question", kind: "free-response", number: { mode: "auto" } },
      schema.nodes.questionStem.create({ id: "nonfirst_stem" }, [
        paragraph("nonfirst_stem_first", "第一段"),
        paragraph("nonfirst_stem_second", "第二段")
      ])
    );
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [question, paragraph("nonfirst_after")]), "nonfirst_stem_second");
    setTextSelection(harness, "nonfirst_stem_second", 0);

    handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent);
    expect(findNodeById(harness.state().doc, "nonfirst_stem_second")?.node.attrs.indentLeftPt).toBe(0);
    expect(findNodeById(harness.state().doc, "nonfirst_stem_second")?.node.textContent).toBe("第二段");
    expect(harness.state().selection).toBeInstanceOf(TextSelection);
    expect(harness.state().selection.$from.parent.attrs.id).toBe("nonfirst_stem_second");
  });

  it.each([
    ["a caret inside the first stem paragraph", () => {
      const question = minimalQuestion("middle_question", "middle_stem_body", "题干正文");
      return { doc: schema.nodes.doc.create(null, [question, paragraph("middle_after")]), paragraphId: "middle_stem_body", offset: 2 };
    }],
    ["a nested question", () => {
      const group = questionGroup("nested_keyboard_group");
      return {
        doc: schema.nodes.doc.create(null, [group, paragraph("nested_keyboard_after")]),
        paragraphId: "nested_keyboard_group_nested_stem_body",
        offset: 0
      };
    }]
  ] as const)("neither selects the question nor leaves the stem from %s", (_label, createFixture) => {
    const fixture = createFixture();
    const harness = freeAuthoringHarness(fixture.doc, fixture.paragraphId);
    setTextSelection(harness, fixture.paragraphId, fixture.offset);
    const before = harness.state().doc;
    const beforeDispatches = harness.dispatchBatches.length;

    handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent);
    expect(harness.dispatchBatches).toHaveLength(beforeDispatches);
    expect(harness.state().doc.eq(before)).toBe(true);
    expect(harness.state().selection).toBeInstanceOf(TextSelection);
  });

  it("undoes and redoes deletion while renumbering fixed questions and preserving external blank links", () => {
    const sourceLine = schema.nodes.paragraph.create({ id: "linked_source_line" }, [
      schema.text("题号 "),
      schema.nodes.blank.create({ id: "linked_blank_1", widthPt: 24, label: "1" }),
      schema.text(" / "),
      schema.nodes.blank.create({ id: "linked_blank_2", widthPt: 24, label: "2" }),
      schema.text(" / "),
      schema.nodes.blank.create({ id: "linked_blank_3", widthPt: 24, label: "3" })
    ]);
    const first = linkedFixedQuestion("linked_question_1", "1", "linked_blank_1");
    const target = linkedFixedQuestion("linked_question_2", "2", "linked_blank_2");
    const third = linkedFixedQuestion("linked_question_3", "3", "linked_blank_3");
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [sourceLine, first, target, third, paragraph("linked_after")]),
      "linked_question_2_stem_body"
    );
    setTextSelection(harness, "linked_question_2_stem_body", 0);
    const beforeDelete = harness.state().doc.toJSON();

    selectQuestion(harness, "linked_question_2");
    expectSelectedQuestion(harness, "linked_question_2");
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);

    expect(findNodeById(harness.state().doc, "linked_question_2")).toBeNull();
    expect(findNodeById(harness.state().doc, "linked_blank_2")).toBeNull();
    expect(findNodeById(harness.state().doc, "linked_question_1")?.node.attrs).toMatchObject({
      number: { mode: "fixed", label: "1" },
      sourceBlankId: "linked_blank_1"
    });
    expect(findNodeById(harness.state().doc, "linked_question_3")?.node.attrs).toMatchObject({
      number: { mode: "fixed", label: "2" },
      sourceBlankId: "linked_blank_3"
    });
    expect(findNodeById(harness.state().doc, "linked_blank_1")?.node.attrs.label).toBe("1");
    expect(findNodeById(harness.state().doc, "linked_blank_3")?.node.attrs.label).toBe("2");
    expect(allIdsAreUnique(harness.state().doc)).toBe(true);
    expectValidChalkLee(harness.state().doc);
    const afterDelete = harness.state().doc.toJSON();

    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.toJSON()).toEqual(beforeDelete);
    expect(findNodeById(harness.state().doc, "linked_blank_2")?.node.attrs.label).toBe("2");
    expect(harness.redo()).toBe(true);
    expect(harness.state().doc.toJSON()).toEqual(afterDelete);
  });

  it.each([
    ["repeated Backspace", "Backspace", { repeat: true }],
    ["Command-Backspace", "Backspace", { metaKey: true }],
    ["Shift-Delete", "Delete", { shiftKey: true }]
  ] as const)("keeps linked cleanup and renumbering for %s after whole-question selection", (_label, key, overrides) => {
    const sourceLine = schema.nodes.paragraph.create({ id: `modified_delete_source_${key}` }, [
      schema.text("题号 "),
      schema.nodes.blank.create({ id: "modified_delete_blank_1", widthPt: 24, label: "1" }),
      schema.text(" / "),
      schema.nodes.blank.create({ id: "modified_delete_blank_2", widthPt: 24, label: "2" }),
      schema.text(" / "),
      schema.nodes.blank.create({ id: "modified_delete_blank_3", widthPt: 24, label: "3" })
    ]);
    const first = linkedFixedQuestion("modified_delete_question_1", "1", "modified_delete_blank_1");
    const target = linkedFixedQuestion("modified_delete_question_2", "2", "modified_delete_blank_2");
    const third = linkedFixedQuestion("modified_delete_question_3", "3", "modified_delete_blank_3");
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [sourceLine, first, target, third, paragraph(`modified_delete_after_${key}`)]),
      "modified_delete_question_2_stem_body"
    );
    setTextSelection(harness, "modified_delete_question_2_stem_body", 0);

    selectQuestion(harness, "modified_delete_question_2");
    expectSelectedQuestion(harness, "modified_delete_question_2");
    expect(handleRegionKeyDown(harness, plainKey(key, overrides) as KeyboardEvent)).toBe(true);

    expect(findNodeById(harness.state().doc, "modified_delete_question_2")).toBeNull();
    expect(findNodeById(harness.state().doc, "modified_delete_blank_2")).toBeNull();
    expect(findNodeById(harness.state().doc, "modified_delete_question_3")?.node.attrs.number)
      .toEqual({ mode: "fixed", label: "2" });
    expect(findNodeById(harness.state().doc, "modified_delete_blank_3")?.node.attrs.label).toBe("2");
    expectValidChalkLee(harness.state().doc);
  });

  it("does not collapse an intentional fixed-number gap when deleting a question", () => {
    const first = fixedQuestion("gap_question_21", "21");
    const target = fixedQuestion("gap_question_22", "22");
    const laterSectionQuestion = fixedQuestion("gap_question_31", "31");
    const harness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [first, target, laterSectionQuestion, paragraph("gap_after")]),
      "gap_question_22_stem_body"
    );
    setTextSelection(harness, "gap_question_22_stem_body", 0);

    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);

    expect(findNodeById(harness.state().doc, "gap_question_21")?.node.attrs.number)
      .toEqual({ mode: "fixed", label: "21" });
    expect(findNodeById(harness.state().doc, "gap_question_31")?.node.attrs.number)
      .toEqual({ mode: "fixed", label: "31" });
  });

  it("unwraps after typed stem content is deleted and lets a reopened pristine auto-question exit", () => {
    const initial = schema.nodes.doc.create(null, [titleHeading(), paragraph("reversible_marker", "1.")]);
    const harness = freeAuthoringHarness(initial, "reversible_marker");
    typeNativePhysicalSpace(harness);
    typeNativeText(harness, "临时题干");
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(false);

    const paragraphNode = findNodeById(harness.state().doc, "reversible_marker");
    if (!paragraphNode) throw new Error("Missing reversible marker paragraph");
    harness.dispatch(harness.state().tr.delete(
      paragraphNode.position + 1,
      paragraphNode.position + 1 + paragraphNode.node.content.size
    ));
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(findNodeById(harness.state().doc, "reversible_marker")?.node.textContent).toBe("1. ");

    const beforeReload = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph("reopened_marker", "1.")]),
      "reopened_marker"
    );
    typeNativePhysicalSpace(beforeReload);
    const persisted = sanitizeChalkLeeEditorJson(beforeReload.state().doc.toJSON());
    const reopened = freeAuthoringHarness(
      schema.nodeFromJSON(persisted),
      "reopened_marker"
    );
    expect(topLevelQuestions(reopened.state().doc)[0].attrs.runtimeAuthoringSource).toBeNull();
    expect(handleRegionKeyDown(reopened, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(reopened.state().doc.lastChild?.textContent).toBe("1.");
  });

  it("preserves paragraph formatting when a reopened pristine auto-question exits", () => {
    const markerId = "reopened_formatted_marker";
    const beforeReload = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph(markerId, "1.")]),
      markerId
    );
    typeNativePhysicalSpace(beforeReload);
    const stemParagraph = findNodeById(beforeReload.state().doc, markerId);
    if (!stemParagraph) throw new Error("Missing reopened formatted paragraph");
    beforeReload.dispatch(beforeReload.state().tr.setNodeMarkup(
      stemParagraph.position,
      undefined,
      {
        ...stemParagraph.node.attrs,
        textAlign: "right",
        indentLeftPt: 18,
        lineHeight: 1.5,
        spaceAfterPt: 6
      }
    ));

    const persisted = sanitizeChalkLeeEditorJson(beforeReload.state().doc.toJSON());
    const reopened = freeAuthoringHarness(schema.nodeFromJSON(persisted), markerId);
    expect(topLevelQuestions(reopened.state().doc)[0].attrs.runtimeAuthoringSource).toBeNull();
    expect(handleRegionKeyDown(reopened, plainKey("Backspace") as KeyboardEvent)).toBe(true);

    const restored = findNodeById(reopened.state().doc, markerId)?.node;
    expect(restored?.textContent).toBe("1.");
    expect(restored?.attrs).toMatchObject({
      textAlign: "right",
      indentLeftPt: 18,
      lineHeight: 1.5,
      spaceAfterPt: 6
    });
    expectValidChalkLee(reopened.state().doc);
  });

  it("does not unwrap a reopened provenance-free empty question before later content", () => {
    const suffixes = [
      paragraph("later_body", "后续正文"),
      minimalQuestion("later_question", "later_stem", "后一道题")
    ];

    for (const [index, suffix] of suffixes.entries()) {
      const markerId = `reopened_nonfinal_marker_${index}`;
      const beforeReload = freeAuthoringHarness(
        schema.nodes.doc.create(null, [titleHeading(), paragraph(markerId, "1.")]),
        markerId
      );
      typeNativePhysicalSpace(beforeReload);
      beforeReload.dispatch(beforeReload.state().tr.insert(beforeReload.state().doc.content.size, suffix));

      const persisted = sanitizeChalkLeeEditorJson(beforeReload.state().doc.toJSON());
      const reopened = freeAuthoringHarness(schema.nodeFromJSON(persisted), markerId);
      const beforeBackspace = reopened.state().doc.toJSON();
      expect(topLevelQuestions(reopened.state().doc)[0].attrs.runtimeAuthoringSource).toBeNull();
      expect(handleRegionKeyDown(reopened, plainKey("Backspace") as KeyboardEvent)).toBe(true);
      expect(reopened.state().selection).toBeInstanceOf(TextSelection);
      expect(reopened.state().doc.toJSON()).toEqual(beforeBackspace);
    }
  });

  it("does not unwrap an empty authored question after lossy semantic settings change", () => {
    const create = () => {
      const harness = freeAuthoringHarness(
        schema.nodes.doc.create(null, [titleHeading(), paragraph("protected_marker", "1.")]),
        "protected_marker"
      );
      typeNativePhysicalSpace(harness);
      return harness;
    };
    const questionMutations: Array<Record<string, unknown>> = [
      { number: { mode: "none" } },
      { sourceBlankId: "blank_1" },
      { score: 2 },
      { difficulty: "hard" },
      { tags: ["重点"] },
      { styleRef: "question.custom" }
    ];

    for (const mutation of questionMutations) {
      const harness = create();
      const location = findNodeById(harness.state().doc, topLevelQuestions(harness.state().doc)[0].attrs.id);
      if (!location) throw new Error("Missing protected question");
      harness.dispatch(harness.state().tr.setNodeMarkup(
        location.position,
        undefined,
        { ...location.node.attrs, ...mutation }
      ));
      const beforeBackspace = harness.state().doc.toJSON();
      expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
      expect(harness.state().selection).toBeInstanceOf(TextSelection);
      expect(harness.state().doc.toJSON()).toEqual(beforeBackspace);
      expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    }

    const styledStem = create();
    const stem = findNodeById(styledStem.state().doc, topLevelQuestions(styledStem.state().doc)[0].firstChild?.attrs.id);
    if (!stem) throw new Error("Missing protected stem");
    styledStem.dispatch(styledStem.state().tr.setNodeMarkup(
      stem.position,
      undefined,
      { ...stem.node.attrs, styleRef: "stem.custom" }
    ));
    const beforeStyledBackspace = styledStem.state().doc.toJSON();
    expect(handleRegionKeyDown(styledStem, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(styledStem.state().selection).toBeInstanceOf(TextSelection);
    expect(styledStem.state().doc.toJSON()).toEqual(beforeStyledBackspace);

    const nonFinal = create();
    nonFinal.dispatch(nonFinal.state().tr.insert(
      nonFinal.state().doc.content.size,
      paragraph("later_content", "后续正文")
    ));
    const beforeNonFinalBackspace = nonFinal.state().doc.toJSON();
    expect(handleRegionKeyDown(nonFinal, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(nonFinal.state().selection).toBeInstanceOf(TextSelection);
    expect(nonFinal.state().doc.toJSON()).toEqual(beforeNonFinalBackspace);

    // Paragraph formatting is not lost: exiting the empty question carries it
    // onto the restored number paragraph, both live and after a reload.
    const formattedParagraph = create();
    const paragraphNode = findNodeById(formattedParagraph.state().doc, "protected_marker");
    if (!paragraphNode) throw new Error("Missing protected paragraph");
    formattedParagraph.dispatch(formattedParagraph.state().tr.setNodeMarkup(
      paragraphNode.position,
      undefined,
      { ...paragraphNode.node.attrs, textAlign: "center" }
    ));
    expect(handleRegionKeyDown(formattedParagraph, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(formattedParagraph.state().doc.lastChild?.attrs.textAlign).toBe("center");
    expect(formattedParagraph.state().doc.lastChild?.textContent).toBe("1. ");
  });

  it("does not unwrap an automatic empty question for modified, repeated, or composing Backspace", () => {
    for (const overrides of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 }
    ]) {
      const harness = freeAuthoringHarness(
        schema.nodes.doc.create(null, [titleHeading(), paragraph("protected_marker", "1.")]),
        "protected_marker"
      );
      typeNativePhysicalSpace(harness);
      const before = harness.dispatchBatches.length;
      expect(handleRegionKeyDown(harness, plainKey("Backspace", overrides) as KeyboardEvent)).toBe(false);
      expect(harness.dispatchBatches).toHaveLength(before);
      expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    }
  });

  it("jumps from a complete final choice tail on `2. ` and keeps a symmetric three-level history", () => {
    const markerId = "next_number_marker";
    const initial = finalChoiceWithTailNumber(markerId, "2.");
    const harness = freeAuthoringHarness(initial, markerId);

    expect(typePhysicalSpace(harness)).toBe(true);
    expect(topLevelTypes(harness.state().doc)).toEqual(["question", "question", "paragraph"]);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
    const next = topLevelQuestions(harness.state().doc)[1];
    expect(next.attrs.kind).toBe("free-response");
    expect(next.attrs.number).toEqual({ mode: "auto" });
    expect(next.content.content.map((node) => node.type.name)).toEqual(["questionStem"]);
    expect(next.firstChild?.firstChild?.attrs.id).toBe(markerId);
    expect(findNodeById(harness.state().doc, markerId)?.node.textContent).toBe("");
    expect(harness.state().selection.$from.node(1)).toBe(next);
    expect(allIdsAreUnique(harness.state().doc)).toBe(true);
    expectValidChalkLee(harness.state().doc);

    harness.dispatch(harness.state().tr.insertText("计算 2x+3=9"));
    expect(topLevelQuestions(harness.state().doc)[1].textContent).toBe("计算 2x+3=9");

    expect(harness.undo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)[1].textContent).toBe("");
    expect(harness.undo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(findNodeById(harness.state().doc, markerId)?.node.textContent).toBe("2. ");
    expect(harness.undo()).toBe(true);
    expect(findNodeById(harness.state().doc, markerId)?.node.textContent).toBe("2.");

    expect(harness.redo()).toBe(true);
    expect(findNodeById(harness.state().doc, markerId)?.node.textContent).toBe("2. ");
    expect(harness.redo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
    expect(harness.redo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)[1].textContent).toBe("计算 2x+3=9");
  });

  it.each([
    ["stem-only", () => finalQuestionWithNumberTail("questionStem", "stem_tail")],
    ["answer without analysis", () => finalQuestionWithNumberTail("questionAnswer", "answer_tail")],
    ["analysis", () => finalQuestionWithNumberTail("questionAnalysis", "analysis_tail")]
  ] as const)("accepts a complete final %s number tail", (_label, createFixture) => {
    const fixture = createFixture();
    const harness = freeAuthoringHarness(fixture.doc, fixture.markerId);

    expect(typePhysicalSpace(harness)).toBe(true);
    expect(topLevelTypes(harness.state().doc)).toEqual(["question", "question", "paragraph"]);
    expect(topLevelQuestions(harness.state().doc)[0].textContent).not.toContain("2.");
    expect(topLevelQuestions(harness.state().doc)[1].attrs).toMatchObject({
      kind: "free-response",
      number: { mode: "auto" }
    });
    expect(harness.state().selection.$from.parent.attrs.id).toBe(fixture.markerId);
    expectValidChalkLee(harness.state().doc);
  });

  it.each([
    ["stem with a later answer region", () => invalidStemTailWithLaterRegion()],
    ["only one option", () => invalidOptionTail({ labels: ["A"] })],
    ["non-contiguous options", () => invalidOptionTail({ labels: ["A", "C"] })],
    ["option followed by answer", () => invalidOptionTail({ labels: ["A", "B"], laterRegion: "questionAnswer" })],
    ["option followed by analysis", () => invalidOptionTail({ labels: ["A", "B"], laterRegion: "questionAnalysis" })],
    ["answer followed by analysis", () => invalidAnswerTailWithAnalysis()],
    ["empty source content", () => invalidEmptyStemTail()],
    ["question-group material", () => invalidQuestionGroupTail()],
    ["nested sub-question", () => invalidNestedQuestionTail()]
  ] as const)("keeps numeric steps local as a list for %s", (_label, createFixture) => {
    const fixture = createFixture();
    const harness = freeAuthoringHarness(fixture.doc, fixture.markerId);

    expect(typePhysicalSpace(harness)).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(topLevelQuestions(fixture.doc).length);
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.attrs).toMatchObject({ listType: "ordered", listStart: 2 });
  });

  it("counts a top-level question group but treats an out-of-sequence root number as a list", () => {
    const group = questionGroup("numbered_group");
    const accepted = schema.nodes.doc.create(null, [group, paragraph("after_group_2", "2.")]);
    const acceptedHarness = freeAuthoringHarness(accepted, "after_group_2");
    expect(typePhysicalSpace(acceptedHarness)).toBe(true);
    expect(topLevelTypes(acceptedHarness.state().doc)).toEqual(["questionGroup", "question", "paragraph"]);

    const skipped = schema.nodes.doc.create(null, [group, paragraph("after_group_3", "3.")]);
    const skippedHarness = freeAuthoringHarness(skipped, "after_group_3");
    expect(typePhysicalSpace(skippedHarness)).toBe(true);
    expect(topLevelQuestions(skippedHarness.state().doc)).toHaveLength(0);
    expect(skippedHarness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: 3 });
    expect(skippedHarness.state().selection.$from.parent.attrs.id).toBe("after_group_3");
  });

  it("counts on from the last question of a passage whose questions continue the paper's numbers", () => {
    const passage = schema.nodes.questionGroup.create({ id: "passage", kind: "reading", number: { mode: "continue" } }, [
      schema.nodes.questionMaterial.create({ id: "passage_material" }, paragraph("passage_material_body", "共用材料")),
      schema.nodes.subQuestionList.create({ id: "passage_subquestions" }, [minimalQuestion("passage_1", "passage_1_body", "小题"), minimalQuestion("passage_2", "passage_2_body", "小题")])
    ]);
    const next = freeAuthoringHarness(schema.nodes.doc.create(null, [passage, paragraph("after_passage_3", "3.")]), "after_passage_3");
    expect(typePhysicalSpace(next)).toBe(true);
    expect(topLevelTypes(next.state().doc)).toEqual(["questionGroup", "question", "paragraph"]);
    expect(topLevelQuestions(next.state().doc)[0].attrs.number).toEqual({ mode: "auto" });

    const repeated = freeAuthoringHarness(schema.nodes.doc.create(null, [passage, paragraph("after_passage_2", "2.")]), "after_passage_2");
    expect(typePhysicalSpace(repeated)).toBe(true);
    expect(topLevelQuestions(repeated.state().doc)).toHaveLength(0);
    expect(repeated.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: 2 });
  });

  it("keeps an out-of-sequence number at a completed question tail in a local list", () => {
    const harness = freeAuthoringHarness(
      finalChoiceWithTailNumber("skipped_number", "3."),
      "skipped_number"
    );

    expect(typePhysicalSpace(harness)).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: 3 });
    expect(harness.state().selection.$from.parent.attrs.id).toBe("skipped_number");
  });

  it("fails closed for IME, paste, repeat and existing list markers, and keeps non-final steps local", () => {
    const repeatHarness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph("repeat_number", "1.")]),
      "repeat_number"
    );
    expect(handleOptionKeyDown(repeatHarness, spaceKey({ repeat: true }) as KeyboardEvent)).toBe(false);
    expect(handleOptionTextInput(repeatHarness, repeatHarness.state().selection.from, repeatHarness.state().selection.from, " ")).toBe(false);
    expect(repeatHarness.dispatchBatches).toHaveLength(0);

    const imeHarness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph("ime_number", "1.")]),
      "ime_number"
    );
    imeHarness.setComposing(true);
    expect(handleOptionKeyDown(imeHarness, spaceKey({ isComposing: true }) as KeyboardEvent)).toBe(false);
    expect(handleOptionTextInput(imeHarness, imeHarness.state().selection.from, imeHarness.state().selection.from, " ")).toBe(false);
    expect(imeHarness.dispatchBatches).toHaveLength(0);

    const pasteHarness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph("paste_number", "1.")]),
      "paste_number"
    );
    expect(handleOptionKeyDown(pasteHarness, spaceKey() as KeyboardEvent)).toBe(false);
    expect(pasteHarness.optionPlugin.props.handlePaste?.call(
      pasteHarness.optionPlugin,
      pasteHarness.view,
      {} as ClipboardEvent,
      {} as never
    )).toBe(false);
    expect(handleOptionTextInput(pasteHarness, pasteHarness.state().selection.from, pasteHarness.state().selection.from, " ")).toBe(false);
    expect(pasteHarness.dispatchBatches).toHaveLength(0);

    const listHarness = freeAuthoringHarness(
      schema.nodes.doc.create(null, [titleHeading(), paragraph("list_number", "1.", { listType: "ordered" })]),
      "list_number"
    );
    expect(typePhysicalSpace(listHarness)).toBe(false);
    expect(listHarness.dispatchBatches).toHaveLength(0);

    const nonFinal = finalChoiceWithTailNumber("nonfinal_number", "2.");
    const extraQuestion = minimalQuestion("later_question", "later_stem", "后一道题");
    const nonFinalDoc = schema.nodes.doc.create(null, [...nonFinal.content.content, extraQuestion]);
    const nonFinalHarness = freeAuthoringHarness(nonFinalDoc, "nonfinal_number");
    expect(typePhysicalSpace(nonFinalHarness)).toBe(true);
    expect(topLevelQuestions(nonFinalHarness.state().doc)).toHaveLength(2);
    expect(nonFinalHarness.state().selection.$from.parent.attrs.listType).toBe("ordered");
  });

  it.each([
    ["a styled list source", paragraph("list_source", "请选择正确选项", { listType: "bullet" })],
    ["a section heading source", paragraph("section_source", "一、选择题")],
    ["instructions", paragraph("instructions_source", "考试说明：请认真作答")]
  ])("does not promote %s before a root A marker", (_label, source) => {
    const markerId = `${String(source.attrs.id)}_a`;
    const doc = schema.nodes.doc.create(null, [titleHeading(), source, paragraph(markerId, "A.")]);
    const harness = freeAuthoringHarness(doc, markerId);

    expect(typePhysicalSpace(harness)).toBe(false);
    expect(harness.dispatchBatches).toHaveLength(0);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
  });
});

describe("ChalkLee question numbers versus ordered lists", () => {
  it.each(["questionStem", "questionAnswer", "questionAnalysis"])("keeps steps, continued items and an empty-item exit inside %s", (regionType) => {
    const fixture = finalQuestionWithNumberTail(regionType as "questionStem" | "questionAnswer" | "questionAnalysis", `steps_${regionType}`);
    const harness = freeAuthoringHarness(fixture.doc, fixture.markerId);
    const selected = findNodeById(harness.state().doc, fixture.markerId)!;
    harness.dispatch(harness.state().tr.insertText("1", selected.position + 1, selected.position + selected.node.nodeSize - 1));
    typeNativeKeyboardText(harness, ".第一步");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: 1 });
    pressNativeEnter(harness);
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: null });
    typeNativeKeyboardText(harness, "第二步");
    pressNativeEnter(harness);
    pressNativeEnter(harness);
    expect(harness.state().selection.$from.node(-1).type.name).toBe(regionType);
    expect(harness.state().selection.$from.parent.attrs.listType).toBeNull();
    // A later explicitly typed step must not jump out of a region containing a list.
    typeNativeKeyboardText(harness, "2.");
    expect(harness.state().selection.$from.parent.attrs.listType).toBe("ordered");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(allIdsAreUnique(harness.state().doc)).toBe(true);
    expectValidChalkLee(harness.state().doc);
  });

  it("respects the list button even when the next consecutive question number is typed", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [
      minimalQuestion("list_priority_question", "list_priority_stem", "已有题目"), paragraph("list_priority_body")
    ]), "list_priority_body");
    harness.dispatch(chalkLeeToggleListTransaction(harness.state(), "ordered")!);
    typeNativeKeyboardText(harness, "2.列表文字");
    pressNativeEnter(harness);
    typeNativeKeyboardText(harness, "后一项");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.state().selection.$from.depth).toBe(1);
    expect(harness.state().selection.$from.parent.attrs.listType).toBe("ordered");
    expectValidChalkLee(harness.state().doc);
  });

  it("defaults ordinary body numbering to a list, preserving its start, formatting and active marks", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [
      titleHeading(), paragraph("instructions", "考试说明：请逐条阅读"),
      schema.nodes.paragraph.create({ id: "list_start", textAlign: "right", lineHeight: 1.8 }, schema.text("21", [schema.marks.bold.create()]))
    ]), "list_start");
    typeNativeKeyboardText(harness, ".第一项");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: 21, textAlign: "right", lineHeight: 1.8 });
    pressNativeEnter(harness);
    typeNativeKeyboardText(harness, "第二项");
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: "ordered", listStart: null, textAlign: "right", lineHeight: 1.8 });
    expect(harness.state().selection.$from.parent.firstChild?.marks.map(mark => mark.type.name)).toContain("bold");
    expectValidChalkLee(harness.state().doc);
  });

  it.each([false, true])("continues fixed 21 with fixed 22 from root or tail (tail: %s)", (tail) => {
    const question = schema.nodes.question.create({ id: "fixed_run", kind: "free-response", number: { mode: "fixed", label: "21" } },
      schema.nodes.questionStem.create({ id: "fixed_run_stem" }, [paragraph("fixed_run_text", "已有题目"), ...(tail ? [paragraph("fixed_run_marker")] : [])]));
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [question, ...(!tail ? [paragraph("fixed_run_marker")] : [])]), "fixed_run_marker");
    typeNativeKeyboardText(harness, "22.");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
    expect(topLevelQuestions(harness.state().doc)[1].attrs.number).toEqual({ mode: "fixed", label: "22" });
    expectValidChalkLee(harness.state().doc);
  });

  it("restores the exact marker in its original analysis on immediate Backspace, without retriggering", () => {
    const fixture = finalQuestionWithNumberTail("questionAnalysis", "cancel_tail");
    const harness = freeAuthoringHarness(fixture.doc, fixture.markerId);
    typeNativePhysicalSpace(harness);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.state().selection.$from.node(-1).type.name).toBe("questionAnalysis");
    expect(harness.state().selection.$from.parent.textContent).toBe("2. ");
    typeNativePhysicalSpace(harness);
    expect(harness.state().selection.$from.parent.textContent).toBe("2.  ");
    expect(harness.state().selection.$from.parent.attrs.listType).toBeNull();
    expectValidChalkLee(harness.state().doc);
  });

  it("restores a list's full-width raw marker, formatting and caret on immediate Backspace", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [
      paragraph("list_cancel_intro", "说明"),
      schema.nodes.paragraph.create({ id: "list_cancel", indentLeftPt: 12 }, schema.text("２１", [schema.marks.italic.create()]))
    ]), "list_cancel");
    typeNativeKeyboardText(harness, "．");
    expect(harness.state().selection.$from.parent.attrs.listStart).toBe(21);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(harness.state().selection.$from.parent.textContent).toBe("２１．");
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: null, indentLeftPt: 12 });
    expect(harness.state().selection.$from.parent.firstChild?.marks[0].type.name).toBe("italic");
    typeNativePhysicalSpace(harness);
    expect(harness.state().selection.$from.parent.textContent).toBe("２１． ");
    expect(harness.state().selection.$from.parent.attrs.listType).toBeNull();
    expect(JSON.stringify(sanitizeChalkLeeEditorJson(harness.state().doc.toJSON()))).not.toContain("runtimeAuthoringSource");
  });

  it.each(["1.5", "21.5", "１．５"])("keeps %s literal while typing", (text) => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("decimal")]), "decimal");
    typeNativeKeyboardText(harness, text);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(harness.state().selection.$from.parent.textContent).toBe(text);
    expect(harness.state().selection.$from.parent.attrs.listType).toBeNull();
    expectValidChalkLee(harness.state().doc);
  });

  it("keeps a number beginning the stem after a confirming Space", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("confirmed_number")]), "confirmed_number");
    typeNativeKeyboardText(harness, "1.");
    typeNativePhysicalSpace(harness);
    typeNativeKeyboardText(harness, "5+3等于多少？");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(firstQuestionStemText(harness.state().doc)).toBe("5+3等于多少？");
  });

  it.each(["ordered", "paragraph"])("corrects a simple auto-question to %s without losing its text, marks, atoms or caret", (value) => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(),
      schema.nodes.paragraph.create({ id: "correctable", lineHeight: 1.5 }, schema.text("21", [schema.marks.bold.create()]))
    ]), "correctable");
    typeNativeKeyboardText(harness, ".求值");
    harness.dispatch(harness.state().tr.insert(harness.state().selection.from, schema.nodes.mathInline.create({ id: "correction_math", latex: "x^2" })));
    expect(chalkLeeActiveBlockStyle(harness.state())).toBe("question");
    const content = harness.state().selection.$from.parent.content;
    const offset = harness.state().selection.$from.parentOffset;
    const transaction = chalkLeeSetBlockStyleTransaction(harness.state(), value);
    expect(transaction).not.toBeNull();
    harness.dispatch(transaction!);
    const paragraph = harness.state().selection.$from.parent;
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(paragraph.attrs).toMatchObject({ id: "correctable", lineHeight: 1.5, listType: value === "ordered" ? "ordered" : null, listStart: value === "ordered" ? 21 : null });
    expect(paragraph.content.cut(value === "paragraph" ? 3 : 0).eq(content)).toBe(true);
    expect(harness.state().selection.$from.parentOffset).toBe(offset + (value === "paragraph" ? 3 : 0));
    expect(paragraph.firstChild?.marks.map(mark => mark.type.name)).toContain("bold");
    expect(chalkLeeActiveBlockStyle(harness.state())).toBe(value);
    expectValidChalkLee(harness.state().doc);
    expect(harness.undo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.redo()).toBe(true);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
  });

  it("uses the list button as the same in-place correction as the block dropdown", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("button_correction")]), "button_correction");
    typeNativeKeyboardText(harness, "1.第一项");
    harness.dispatch(chalkLeeToggleListTransaction(harness.state(), "ordered")!);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(harness.state().selection.$from.parent.textContent).toBe("第一项");
    pressNativeEnter(harness);
    typeNativeKeyboardText(harness, "第二项");
    expect(harness.state().selection.$from.parent.attrs.listType).toBe("ordered");
  });

  it("does not unwrap a question when adding a list to a later stem paragraph", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("multi_stem")]), "multi_stem");
    typeNativeKeyboardText(harness, "1.请按步骤计算");
    pressNativeEnter(harness);
    harness.dispatch(chalkLeeToggleListTransaction(harness.state(), "ordered")!);
    typeNativeKeyboardText(harness, "先展开");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(harness.state().selection.$from.node(-1).type.name).toBe("questionStem");
    expect(harness.state().selection.$from.node(-1).firstChild?.textContent).toBe("请按步骤计算");
    expect(chalkLeeCanSetBlockStyle(harness.state(), "question")).toBe(false);
    expect(chalkLeeCanSetBlockStyle(harness.state(), "heading-1")).toBe(false);
    expectValidChalkLee(harness.state().doc);
  });

  it("never unwraps or drops properties from a mature question when changing paragraph type", () => {
    const fixture = finalChoiceWithTailNumber("mature_paragraph", "步骤内容");
    const harness = freeAuthoringHarness(fixture, "mature_paragraph");
    const original = topLevelQuestions(harness.state().doc)[0];
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "ordered")!);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(topLevelQuestions(harness.state().doc)[0].attrs).toEqual(original.attrs);
    expect(topLevelQuestions(harness.state().doc)[0].childCount).toBe(original.childCount);
    expect(harness.state().selection.$from.node(-1).type.name).toBe("option");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "paragraph")!);
    expect(sanitizeChalkLeeEditorJson(topLevelQuestions(harness.state().doc)[0].toJSON())).toEqual(sanitizeChalkLeeEditorJson(original.toJSON()));
    expectValidChalkLee(harness.state().doc);
  });

  it("preserves a continued list item's visible number when explicitly changing it to a question", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [
      paragraph("numbered_first", "前一项", { listType: "ordered", listStart: 21 }),
      paragraph("numbered_next", "待改为题目", { listType: "ordered" })
    ]), "numbered_next");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "question")!);
    expect(topLevelQuestions(harness.state().doc)[0].attrs.number).toEqual({ mode: "fixed", label: "22" });
    expect(harness.state().selection.$from.parent.textContent).toBe("待改为题目");
    expect(harness.state().selection.$from.parentOffset).toBe(5);
    expectValidChalkLee(harness.state().doc);
  });

  it("lets an explicit body choice suppress number recognition until the next paragraph", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("literal_body")]), "literal_body");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "paragraph")!);
    typeNativeKeyboardText(harness, "1.");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(0);
    expect(harness.state().selection.$from.parent.attrs.listType).toBeNull();
    const transaction = chalkLeeSetBlockStyleTransaction(harness.state(), "question");
    expect(transaction).not.toBeNull();
    harness.dispatch(transaction!);
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(1);
    expect(firstQuestionStemText(harness.state().doc)).toBe("");
  });

  it("removes only the list formatting at the beginning of a populated item", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [
      paragraph("populated_item", "保留内容", { listType: "ordered", listStart: 5 })
    ]), "populated_item");
    setTextSelection(harness, "populated_item", 0);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    expect(harness.state().selection.$from.parent.textContent).toBe("保留内容");
    expect(harness.state().selection.$from.parent.attrs).toMatchObject({ listType: null, listStart: null });
    expect(harness.state().selection.$from.parentOffset).toBe(0);
  });

  it("does not carry a canceled prefix into a new paragraph in the same region", () => {
    const fixture = finalQuestionWithNumberTail("questionAnalysis", "one_paragraph_intent");
    const harness = freeAuthoringHarness(fixture.doc, fixture.markerId);
    typeNativePhysicalSpace(harness);
    expect(handleRegionKeyDown(harness, plainKey("Backspace") as KeyboardEvent)).toBe(true);
    pressNativeEnter(harness);
    expect(harness.state().selection.$from.parent.attrs.runtimeAuthoringSource).toBeNull();
    typeNativeKeyboardText(harness, "2.");
    expect(topLevelQuestions(harness.state().doc)).toHaveLength(2);
  });

  it("keeps the entire decimal when the teacher explicitly makes its paragraph a question", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("decimal_question")]), "decimal_question");
    typeNativeKeyboardText(harness, "1.5是多少？");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "question")!);
    expect(firstQuestionStemText(harness.state().doc)).toBe("1.5是多少？");
    expectValidChalkLee(harness.state().doc);
  });

  it("round-trips a corrected numeric paragraph without requiring whitespace after its marker", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("roundtrip_number")]), "roundtrip_number");
    typeNativeKeyboardText(harness, "21.内容");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "paragraph")!);
    expect(harness.state().selection.$from.parent.textContent).toBe("21.内容");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "question")!);
    expect(firstQuestionStemText(harness.state().doc)).toBe("内容");
    expect(chalkLeeActiveBlockStyle(harness.state())).toBe("question");
    expect(harness.state().selection.$from.parentOffset).toBe(2);
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "paragraph")!);
    expect(harness.state().selection.$from.parent.textContent).toBe("21.内容");
    expectValidChalkLee(harness.state().doc);
  });

  it("does not reinterpret numeric text after a leading inline atom when explicitly making a question", () => {
    const body = schema.nodes.paragraph.create({ id: "atom_number" }, [schema.nodes.mathInline.create({ latex: "x" }), schema.text("21. 内容")]);
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), body]), "atom_number");
    harness.dispatch(chalkLeeSetBlockStyleTransaction(harness.state(), "question")!);
    expect(harness.state().selection.$from.parent.content.eq(body.content)).toBe(true);
    expectValidChalkLee(harness.state().doc);
  });

  it("retains semantic properties on a newly numbered question when applying a list", () => {
    const harness = freeAuthoringHarness(schema.nodes.doc.create(null, [titleHeading(), paragraph("scored_number")]), "scored_number");
    typeNativeKeyboardText(harness, "1.题干");
    const question = topLevelQuestions(harness.state().doc)[0];
    harness.dispatch(harness.state().tr.setNodeMarkup(harness.state().selection.$from.before(1), undefined, { ...question.attrs, score: 5 }));
    harness.dispatch(chalkLeeToggleListTransaction(harness.state(), "ordered")!);
    expect(topLevelQuestions(harness.state().doc)[0].attrs.score).toBe(5);
    expect(firstQuestionStemText(harness.state().doc)).toBe("题干");
    expect(harness.state().selection.$from.node(-1).type.name).toBe("questionStem");
    expectValidChalkLee(harness.state().doc);
  });
});

function freeAuthoringHarness(doc: ProseMirrorNode, selectionParagraphId: string): FreeAuthoringHarness {
  const optionStorage: OptionAuthoringStorage = {
    physicalSpacePending: false,
    composing: false,
    generation: 0,
    timer: null
  };
  const regionStorage: RegionAuthoringStorage = {
    composing: false,
    generation: 0,
    timer: null,
    pendingParagraphId: null,
    pendingTarget: null
  };
  const optionPlugin = extensionPlugins<OptionAuthoringStorage>(ChalkLeeOptionAuthoringExtension, optionStorage)[0];
  const regionPlugin = extensionPlugins<RegionAuthoringStorage>(ChalkLeeQuestionRegionAuthoringExtension, regionStorage)[0];
  const stableIdPlugin = extensionPlugins(ChalkLeeStableIdExtension, {})[0];
  const selected = findNodeById(doc, selectionParagraphId);
  if (!selected) throw new Error(`Missing selection paragraph ${selectionParagraphId}`);
  let state = EditorState.create({
    schema,
    doc,
    plugins: [history(), stableIdPlugin, optionPlugin, regionPlugin],
    selection: TextSelection.create(doc, selected.position + 1 + selected.node.content.size)
  });
  const dispatchBatches: Array<readonly Transaction[]> = [];
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
    dom: { dispatchEvent: () => true },
    dispatch(transaction: Transaction) {
      const applied = state.applyTransaction(transaction);
      dispatchBatches.push(applied.transactions);
      state = applied.state;
    }
  } as unknown as EditorView;
  const dispatch = (transaction: Transaction) => view.dispatch(transaction);
  return {
    view,
    optionPlugin,
    regionPlugin,
    state: () => state,
    dispatch,
    setComposing(value) {
      composing = value;
    },
    dispatchBatches,
    undo: () => undo(state, dispatch),
    redo: () => redo(state, dispatch)
  };
}

function extensionPlugins<TStorage>(
  extension: { config: { addProseMirrorPlugins?: unknown } },
  storage: TStorage
) {
  const addPlugins = extension.config.addProseMirrorPlugins as unknown as (
    this: { storage: TStorage }
  ) => Plugin[];
  return addPlugins.call({ storage });
}

function typePhysicalSpace(harness: FreeAuthoringHarness) {
  const position = harness.state().selection.from;
  expect(handleOptionKeyDown(harness, spaceKey() as KeyboardEvent)).toBe(false);
  return handleOptionTextInput(harness, position, position, " ");
}

function typeNativePhysicalSpace(harness: FreeAuthoringHarness) {
  const position = harness.state().selection.from;
  expect(handleOptionKeyDown(harness, spaceKey() as KeyboardEvent)).toBe(false);
  if (handleOptionTextInput(harness, position, position, " ")) return;
  if (handleRegionTextInput(harness, position, position, " ")) return;
  harness.dispatch(harness.state().tr.insertText(" ", position, position));
}

function typeNativeText(harness: FreeAuthoringHarness, text: string) {
  for (const character of text) {
    const position = harness.state().selection.from;
    if (handleOptionTextInput(harness, position, position, character)) continue;
    if (handleRegionTextInput(harness, position, position, character)) continue;
    harness.dispatch(harness.state().tr.insertText(character, position, position));
  }
}

function typeNativeKeyboardText(harness: FreeAuthoringHarness, text: string) {
  for (const character of text) {
    expect(handleOptionKeyDown(harness, plainKey(character) as KeyboardEvent)).toBe(false);
    const position = harness.state().selection.from;
    if (handleOptionTextInput(harness, position, position, character)) continue;
    if (handleRegionTextInput(harness, position, position, character)) continue;
    harness.dispatch(harness.state().tr.insertText(character, position, position));
  }
}

function pressNativeEnter(harness: FreeAuthoringHarness) {
  const event = plainKey("Enter") as KeyboardEvent;
  expect(handleOptionKeyDown(harness, event)).toBe(false);
  if (handleRegionKeyDown(harness, event)) return;
  expect(splitBlock(harness.state(), harness.dispatch, harness.view)).toBe(true);
}

function setTextSelection(harness: FreeAuthoringHarness, paragraphId: string, offset: number) {
  const paragraphNode = findNodeById(harness.state().doc, paragraphId);
  if (!paragraphNode || paragraphNode.node.type.name !== "paragraph") {
    throw new Error(`Missing selection paragraph ${paragraphId}`);
  }
  harness.dispatch(harness.state().tr.setSelection(TextSelection.create(
    harness.state().doc,
    paragraphNode.position + 1 + offset
  )));
}

function selectQuestion(harness: FreeAuthoringHarness, questionId: string) {
  const location = findNodeById(harness.state().doc, questionId);
  if (!location) throw new Error(`Missing question ${questionId}`);
  harness.dispatch(harness.state().tr.setSelection(NodeSelection.create(harness.state().doc, location.position)));
}

function expectSelectedQuestion(harness: FreeAuthoringHarness, questionId: unknown) {
  expect(harness.state().selection).toBeInstanceOf(NodeSelection);
  const selection = harness.state().selection as NodeSelection;
  expect(selection.$from.depth).toBe(0);
  expect(selection.node.type.name).toBe("question");
  expect(selection.node.attrs.id).toBe(questionId);
}

function handleOptionKeyDown(harness: FreeAuthoringHarness, event: KeyboardEvent) {
  return harness.optionPlugin.props.handleKeyDown?.call(harness.optionPlugin, harness.view, event) ?? false;
}

function handleOptionTextInput(harness: FreeAuthoringHarness, from: number, to: number, text: string) {
  return harness.optionPlugin.props.handleTextInput?.call(
    harness.optionPlugin,
    harness.view,
    from,
    to,
    text,
    () => harness.state().tr.insertText(text, from, to)
  ) ?? false;
}

function handleRegionTextInput(harness: FreeAuthoringHarness, from: number, to: number, text: string) {
  const handled = harness.regionPlugin.props.handleTextInput?.call(
    harness.regionPlugin,
    harness.view,
    from,
    to,
    text,
    () => harness.state().tr.insertText(text, from, to)
  ) ?? false;
  if (handled) vi.runOnlyPendingTimers();
  return handled;
}

function handleRegionKeyDown(harness: FreeAuthoringHarness, event: KeyboardEvent) {
  return harness.regionPlugin.props.handleKeyDown?.call(harness.regionPlugin, harness.view, event) ?? false;
}

function spaceKey(overrides: Partial<KeyboardEvent> = {}) {
  return plainKey(" ", overrides);
}

function plainKey(key: string, overrides: Partial<KeyboardEvent> = {}) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...overrides
  };
}

function pristineDocument() {
  return schema.nodes.doc.create(null, [titleHeading(), paragraph("pristine_body")]);
}

function titleHeading() {
  return schema.nodes.heading.create(
    {
      id: "title",
      level: 1,
      textAlign: "center",
      lineHeight: 1.95,
      spaceBeforePt: 0,
      spaceAfterPt: 0
    },
    schema.text("九年级数学测试", [
      schema.marks.bold.create(),
      schema.marks.textStyle.create({ fontSizePt: 16 })
    ])
  );
}

function paragraph(id: string, text = "", attrs: Record<string, unknown> = {}) {
  return schema.nodes.paragraph.create(
    { id, ...attrs },
    text ? schema.text(text) : undefined
  );
}

function minimalQuestion(id: string, stemId: string, stemText: string) {
  return schema.nodes.question.create(
    { id, kind: "free-response", number: { mode: "auto" } },
    schema.nodes.questionStem.create({ id: `${id}_stem` }, paragraph(stemId, stemText))
  );
}

function fixedQuestion(id: string, label: string) {
  return schema.nodes.question.create(
    { id, kind: "free-response", number: { mode: "fixed", label } },
    schema.nodes.questionStem.create(
      { id: `${id}_stem` },
      paragraph(`${id}_stem_body`, `第 ${label} 题`)
    )
  );
}

function completeChoiceQuestion(id: string) {
  const stem = schema.nodes.questionStem.create(
    { id: `${id}_stem` },
    paragraph(`${id}_stem_body`, "下列结论正确的是")
  );
  const options = schema.nodes.optionGroup.create({ id: `${id}_options`, layout: "auto" }, [
    schema.nodes.option.create(
      { id: `${id}_option_a`, label: "A" },
      paragraph(`${id}_option_a_body`, "选项甲")
    ),
    schema.nodes.option.create(
      { id: `${id}_option_b`, label: "B" },
      [
        paragraph(`${id}_option_b_first`, "选项乙第一段"),
        paragraph(`${id}_option_b_second`, "选项乙第二段")
      ]
    )
  ]);
  const answer = schema.nodes.questionAnswer.create(
    { id: `${id}_answer`, runtimeLabel: "答案" },
    paragraph(`${id}_answer_body`, "B")
  );
  const analysis = schema.nodes.questionAnalysis.create(
    { id: `${id}_analysis`, runtimeLabel: "解析" },
    paragraph(`${id}_analysis_body`, "由定义可得")
  );
  return schema.nodes.question.create(
    { id, kind: "single-choice", number: { mode: "auto" } },
    [stem, options, answer, analysis]
  );
}

function linkedFixedQuestion(id: string, label: string, sourceBlankId: string) {
  return schema.nodes.question.create(
    {
      id,
      kind: "free-response",
      number: { mode: "fixed", label },
      sourceBlankId
    },
    schema.nodes.questionStem.create(
      { id: `${id}_stem` },
      paragraph(`${id}_stem_body`, `第 ${label} 题`)
    )
  );
}

function finalChoiceWithTailNumber(markerId: string, markerText: string) {
  const stem = schema.nodes.questionStem.create(
    { id: "choice_stem" },
    paragraph("choice_stem_body", "下列结果正确的是")
  );
  const optionA = schema.nodes.option.create(
    { id: "choice_a", label: "A" },
    paragraph("choice_a_body", "3")
  );
  const optionB = schema.nodes.option.create(
    { id: "choice_b", label: "B" },
    [paragraph("choice_b_body", "4"), paragraph(markerId, markerText)]
  );
  const options = schema.nodes.optionGroup.create(
    { id: "choice_options", layout: "auto" },
    [optionA, optionB]
  );
  const question = schema.nodes.question.create(
    { id: "choice_question", kind: "single-choice", number: { mode: "auto" } },
    [stem, options]
  );
  return schema.nodes.doc.create(null, question);
}

function finalQuestionWithNumberTail(
  sourceType: "questionStem" | "questionAnswer" | "questionAnalysis",
  markerId: string
) {
  const stemContent = sourceType === "questionStem"
    ? [paragraph(`${markerId}_stem_body`, "求未知数"), paragraph(markerId, "2.")]
    : [paragraph(`${markerId}_stem_body`, "求未知数")];
  const stem = schema.nodes.questionStem.create({ id: `${markerId}_stem` }, stemContent);
  const content: ProseMirrorNode[] = [stem];
  if (sourceType === "questionAnswer") {
    content.push(schema.nodes.questionAnswer.create(
      { id: `${markerId}_answer` },
      [paragraph(`${markerId}_answer_body`, "x=1"), paragraph(markerId, "2.")]
    ));
  }
  if (sourceType === "questionAnalysis") {
    content.push(schema.nodes.questionAnswer.create(
      { id: `${markerId}_answer` },
      paragraph(`${markerId}_answer_body`, "x=1")
    ));
    content.push(schema.nodes.questionAnalysis.create(
      { id: `${markerId}_analysis` },
      [paragraph(`${markerId}_analysis_body`, "移项求解"), paragraph(markerId, "2.")]
    ));
  }
  const question = schema.nodes.question.create(
    { id: `${markerId}_question`, kind: "free-response", number: { mode: "auto" } },
    content
  );
  return { doc: schema.nodes.doc.create(null, question), markerId };
}

function invalidStemTailWithLaterRegion() {
  const markerId = "invalid_stem_later_marker";
  const stem = schema.nodes.questionStem.create(
    { id: "invalid_stem_later_stem" },
    [paragraph("invalid_stem_later_body", "题干"), paragraph(markerId, "2.")]
  );
  const answer = schema.nodes.questionAnswer.create(
    { id: "invalid_stem_later_answer" },
    paragraph("invalid_stem_later_answer_body", "答案")
  );
  return {
    doc: schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: "invalid_stem_later_question", kind: "free-response", number: { mode: "auto" } },
      [stem, answer]
    )),
    markerId
  };
}

function invalidOptionTail({
  labels,
  laterRegion
}: {
  labels: string[];
  laterRegion?: "questionAnswer" | "questionAnalysis";
}) {
  const markerId = `invalid_options_${labels.join("").toLocaleLowerCase()}_${laterRegion ?? "none"}_marker`;
  const stem = schema.nodes.questionStem.create(
    { id: `${markerId}_stem` },
    paragraph(`${markerId}_stem_body`, "选择正确答案")
  );
  const options = labels.map((label, index) => schema.nodes.option.create(
    { id: `${markerId}_option_${label}`, label },
    index === labels.length - 1
      ? [paragraph(`${markerId}_option_body`, `选项${label}`), paragraph(markerId, "2.")]
      : paragraph(`${markerId}_option_${label}_body`, `选项${label}`)
  ));
  const optionGroup = schema.nodes.optionGroup.create({ id: `${markerId}_options` }, options);
  const content: ProseMirrorNode[] = [stem, optionGroup];
  if (laterRegion === "questionAnswer") {
    content.push(schema.nodes.questionAnswer.create(
      { id: `${markerId}_answer` },
      paragraph(`${markerId}_answer_body`, "A")
    ));
  }
  if (laterRegion === "questionAnalysis") {
    content.push(schema.nodes.questionAnalysis.create(
      { id: `${markerId}_analysis` },
      paragraph(`${markerId}_analysis_body`, "分析")
    ));
  }
  return {
    doc: schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: `${markerId}_question`, kind: "single-choice", number: { mode: "auto" } },
      content
    )),
    markerId
  };
}

function invalidAnswerTailWithAnalysis() {
  const markerId = "invalid_answer_analysis_marker";
  const stem = schema.nodes.questionStem.create(
    { id: "invalid_answer_analysis_stem" },
    paragraph("invalid_answer_analysis_stem_body", "题干")
  );
  const answer = schema.nodes.questionAnswer.create(
    { id: "invalid_answer_analysis_answer" },
    [paragraph("invalid_answer_analysis_answer_body", "42"), paragraph(markerId, "2.")]
  );
  const analysis = schema.nodes.questionAnalysis.create(
    { id: "invalid_answer_analysis_analysis" },
    paragraph("invalid_answer_analysis_analysis_body", "已有解析")
  );
  return {
    doc: schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: "invalid_answer_analysis_question", kind: "free-response", number: { mode: "auto" } },
      [stem, answer, analysis]
    )),
    markerId
  };
}

function invalidEmptyStemTail() {
  const markerId = "invalid_empty_stem_marker";
  const stem = schema.nodes.questionStem.create(
    { id: "invalid_empty_stem" },
    [paragraph("invalid_empty_stem_body"), paragraph(markerId, "2.")]
  );
  return {
    doc: schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: "invalid_empty_stem_question", kind: "free-response", number: { mode: "auto" } },
      stem
    )),
    markerId
  };
}

function invalidQuestionGroupTail() {
  const markerId = "invalid_group_material_marker";
  const nested = minimalQuestion("invalid_group_nested", "invalid_group_nested_stem", "小题");
  const group = schema.nodes.questionGroup.create(
    { id: "invalid_group", kind: "reading", number: { mode: "auto" } },
    [
      schema.nodes.questionMaterial.create(
        { id: "invalid_group_material" },
        [paragraph("invalid_group_material_body", "共用材料"), paragraph(markerId, "2.")]
      ),
      schema.nodes.subQuestionList.create({ id: "invalid_group_subquestions" }, nested)
    ]
  );
  return { doc: schema.nodes.doc.create(null, group), markerId };
}

function invalidNestedQuestionTail() {
  const markerId = "invalid_nested_marker";
  const nestedStem = schema.nodes.questionStem.create(
    { id: "invalid_nested_stem" },
    [paragraph("invalid_nested_stem_body", "小题题干"), paragraph(markerId, "2.")]
  );
  const nested = schema.nodes.question.create(
    { id: "invalid_nested_question", kind: "free-response", number: { mode: "auto" } },
    nestedStem
  );
  const group = schema.nodes.questionGroup.create(
    { id: "invalid_nested_group", kind: "reading", number: { mode: "auto" } },
    [
      schema.nodes.questionMaterial.create(
        { id: "invalid_nested_material" },
        paragraph("invalid_nested_material_body", "共用材料")
      ),
      schema.nodes.subQuestionList.create({ id: "invalid_nested_subquestions" }, nested)
    ]
  );
  return { doc: schema.nodes.doc.create(null, group), markerId };
}

function questionGroup(id: string) {
  const nested = minimalQuestion(`${id}_nested`, `${id}_nested_stem_body`, "小题");
  return schema.nodes.questionGroup.create(
    { id, kind: "reading", number: { mode: "auto" } },
    [
      schema.nodes.questionMaterial.create(
        { id: `${id}_material` },
        paragraph(`${id}_material_body`, "共用材料")
      ),
      schema.nodes.subQuestionList.create({ id: `${id}_subquestions` }, nested)
    ]
  );
}

function topLevelTypes(doc: ProseMirrorNode) {
  return doc.content.content.map((node) => node.type.name);
}

function topLevelQuestions(doc: ProseMirrorNode) {
  return doc.content.content.filter((node) => node.type.name === "question");
}

function firstQuestionStemText(doc: ProseMirrorNode) {
  return topLevelQuestions(doc)[0]?.content.content.find((node) => node.type.name === "questionStem")?.textContent ?? "";
}

function questionRegionText(doc: ProseMirrorNode, regionType: string) {
  return topLevelQuestions(doc)[0]?.content.content.find((node) => node.type.name === regionType)?.textContent ?? "";
}

function findNodeById(
  doc: ProseMirrorNode,
  id: string
): { node: ProseMirrorNode; position: number } | null {
  let found: { node: ProseMirrorNode; position: number } | null = null;
  doc.descendants((node, position) => {
    if (node.attrs.id !== id) return true;
    found = { node, position };
    return false;
  });
  return found;
}

function nodeIds(doc: ProseMirrorNode) {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (typeof node.attrs.id === "string" && node.attrs.id) ids.push(node.attrs.id);
  });
  return ids;
}

function allIdsAreUnique(doc: ProseMirrorNode) {
  const ids = nodeIds(doc);
  return new Set(ids).size === ids.length;
}

function expectValidChalkLee(doc: ProseMirrorNode) {
  let index = 0;
  const document = createEmptyChalkLeeDocument(
    "自由录题回归",
    () => `validation_${++index}`,
    "2026-09-04T00:00:00.000Z"
  ) as ChalkLeeDocument;
  document.content = sanitizeChalkLeeEditorJson(doc.toJSON()) as ChalkLeeRootNode;
  expect(validateChalkLeeSemantics(document)).toEqual([]);
}
