import { describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { parseHTML } from "linkedom";
import { chalkLeeLongTables, discardChalkLeeFlowMeasurements, measureChalkLeePagination } from "./paginationMeasure";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { ChalkLeePaginationGapsExtension, chalkLeePaginationGapsKey, setChalkLeeColumnPageBreaks, setChalkLeePageGaps } from "./extensions/pageGaps";
import { chalkLeeEditedTopLevelStem, createChalkLeePaginationSettler, keepChalkLeeQuestionOpeningsTogether, keepChalkLeeQuestionStartsTogether, measureWithoutChalkLeePageGaps, replaceChalkLeeFlowRanges } from "./pagination";
import { keepChalkLeeFrameEdges } from "./pagination";
import { chalkLeeColumnPageCount, chalkLeeColumnsRemaining, chalkLeeNodeEndPositionAt, chalkLeeNodeStartPositionAt, currentChalkLeeViewportPage, keepChalkLeeHeadingsWithNext, keepChalkLeeOptionMarkersWithContent, keepChalkLeeShortGroupsTogether, measureChalkLeeGapHeightAbove, mergeChalkLeeFlowLines, paginateChalkLeeFlow, tableRowBreakAvailability, type ChalkLeePaginationFlowItem } from "./pagination";

describe("ChalkLee pagination", () => {
  it("keeps three-line introductions whole and allows longer introductions to split between pairs", () => {
    const lines = Array.from({ length: 6 }, (_, index) => ({ pos: index * 10, top: index * 20, bottom: index * 20 + 20 }));
    expect(keepChalkLeeQuestionOpeningsTogether(lines, [{ from: 10, to: 40 }], 100)).toEqual([
      lines[0], { ...lines[1], bottom: lines[3].bottom }, lines[4], lines[5]
    ]);
    expect(keepChalkLeeQuestionOpeningsTogether(lines, [{ from: 10, to: 50 }], 100)).toEqual([
      lines[0], { ...lines[1], bottom: lines[2].bottom }, { ...lines[3], bottom: lines[4].bottom }, lines[5]
    ]);
  });
  it("keeps a long question's first two lines with its heading without binding the whole question", () => {
    const flow = [{ pos: 1, top: 0, bottom: 70 }, { pos: 10, top: 70, bottom: 80 },
      { pos: 20, top: 80, bottom: 95 }, { pos: 30, top: 95, bottom: 110 }, { pos: 40, top: 110, bottom: 180 }];
    const openings = [{ from: 20, to: 40 }];
    const grouped = keepChalkLeeQuestionOpeningsTogether(flow, openings, 100);
    expect(paginateChalkLeeFlow(keepChalkLeeHeadingsWithNext(grouped, [{ from: 10, to: 20 }], 100), 100)[0])
      .toMatchObject({ pos: 10, startPx: 70 });
    expect(grouped.at(-1)).toEqual(flow.at(-1));
    expect(keepChalkLeeQuestionOpeningsTogether(flow, [{ from: 20, to: 30 }], 100)).toEqual(flow);
    const manual = flow.map(item => item.pos === 30 ? { ...item, forced: true } : item);
    expect(keepChalkLeeQuestionOpeningsTogether(manual, openings, 100)).toEqual(manual);
  });
  it("breaks before a long question, not inside its numbered first paragraph", () => {
    const flow = [{ pos: 1, top: 0, bottom: 90 }, { pos: 12, top: 92, bottom: 102 }, { pos: 20, top: 102, bottom: 112 }, { pos: 30, top: 112, bottom: 180 }];
    const opening = { from: 11, to: 25, start: { pos: 10, top: 90 } };
    const grouped = keepChalkLeeQuestionOpeningsTogether(flow, [opening], 100);
    expect(paginateChalkLeeFlow(grouped, 100)[0]).toMatchObject({ pos: 10 });
    // Content of the question measured above the paragraph keeps its own break.
    const leading = [flow[0], { pos: 10.5, top: 90, bottom: 92 }, ...flow.slice(1)];
    expect(keepChalkLeeQuestionOpeningsTogether(leading, [opening], 100)[2]).toMatchObject({ pos: 12 });
  });
  it("moves a page break at a question's first content before the question so its handle never stays behind", () => {
    // A passage starting with a centered title or an image/table has its first flow item inside the question.
    const flow = [
      { pos: 1, top: 0, bottom: 85 },
      { pos: 14, top: 88, bottom: 112 },
      { pos: 30, top: 112, bottom: 180 }
    ];
    const started = keepChalkLeeQuestionStartsTogether(flow, [{ from: 10, to: 60, top: 86 }]);
    expect(paginateChalkLeeFlow(started, 100)).toMatchObject([{ pos: 10, startPx: 86 }]);
    // Later lines inside the question still paginate normally when the first line fits.
    const split = keepChalkLeeQuestionStartsTogether([
      { pos: 14, top: 70, bottom: 92 },
      { pos: 30, top: 92, bottom: 118 }
    ], [{ from: 10, to: 60, top: 68 }]);
    expect(paginateChalkLeeFlow(split, 100)).toMatchObject([{ pos: 30, startPx: 92 }]);
    // A heading already merged before the question keeps its heading start.
    const withHeading = keepChalkLeeQuestionStartsTogether([
      { pos: 5, top: 76, bottom: 112 },
      { pos: 30, top: 112, bottom: 180 }
    ], [{ from: 10, to: 60, top: 88 }]);
    expect(withHeading[0]).toMatchObject({ pos: 5, top: 76 });
    expect(withHeading[1]).toMatchObject({ pos: 30, top: 112 });
    // A long table opening a question moves the whole question when breaking at the table's opening.
    const withTable = keepChalkLeeQuestionStartsTogether([
      { pos: 1, top: 0, bottom: 80 },
      { pos: 15, top: 84, bottom: 110, kind: "table", tableGroup: "t1", tableStart: 12 },
      { pos: 25, top: 110, bottom: 150, kind: "table", tableGroup: "t1" }
    ], [{ from: 10, to: 60, top: 82 }]);
    expect(paginateChalkLeeFlow(withTable, 100)).toMatchObject([{ pos: 10, startPx: 82 }]);
  });
  it("moves a tall inline formula with its prefix and punctuation instead of splitting the line", () => {
    const lines = mergeChalkLeeFlowLines([
      { pos: 1, top: 0, bottom: 20 },
      { pos: 30, top: 110, bottom: 130 },
      { pos: 40, top: 100, bottom: 140, inline: true },
      { pos: 41, top: 110, bottom: 130 },
      { pos: 45, top: 145, bottom: 165 }
    ]);
    expect(lines.map(({ pos, top, bottom }) => ({ pos, top, bottom }))).toEqual([
      { pos: 1, top: 0, bottom: 20 },
      { pos: 30, top: 100, bottom: 140 },
      { pos: 45, top: 145, bottom: 165 }
    ]);
    expect(paginateChalkLeeFlow(lines, 120)).toMatchObject([{ pos: 30, startPx: 100 }]);
  });

  it("measures page gaps and repeated headers once for all lines in a reflow", () => {
    const bounds = [{ top: 100, height: 40 }, { top: 140, height: 20 }, { top: 200, height: 0 }, { top: 300, height: 50 }];
    const elements = bounds.map(rect => ({ getBoundingClientRect: vi.fn(() => ({ ...rect })) }));
    const content = { querySelectorAll: vi.fn(() => elements) } as unknown as HTMLElement;
    const onGap = vi.fn();
    const above = measureChalkLeeGapHeightAbove(content, onGap);
    expect(above(90)).toBe(0);
    expect(above(120)).toBe(20);
    expect(above(150)).toBe(50);
    expect(above(160)).toBe(60);
    expect(above(325)).toBe(85);
    for (let y = 0; y < 1000; y++) above(y);
    expect(content.querySelectorAll).toHaveBeenCalledOnce();
    elements.forEach(element => expect(element.getBoundingClientRect).toHaveBeenCalledOnce());
    expect(onGap.mock.calls).toEqual([[elements[0], 40], [elements[1], 20], [elements[3], 50]]);
    bounds[0].height = 30;
    expect(above(200)).toBe(60);
    expect(measureChalkLeeGapHeightAbove(content)(200)).toBe(50);
  });

  it("reuses unchanged text and formula positions through edits and remeasures changed DOM", () => {
    const { document, window } = parseHTML(`<html><body><main class="chalklee-paper"><div class="chalklee-editor-content">
      <section><p data-line-top="20">First question</p></section>
      <section><p data-line-top="1100">Second question<span data-chalklee-inline-math></span></p></section>
    </div></main></body></html>`);
    const content = document.querySelector<HTMLElement>(".chalklee-editor-content")!;
    const [first, second] = Array.from(content.querySelectorAll("section"));
    const secondText = second.querySelector("p")!;
    const formula = secondText.querySelector<HTMLElement>("span")!;
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, width: 500 }) as DOMRect;
    content.getBoundingClientRect = () => rect(0, 1200);
    first.getBoundingClientRect = () => rect(0, 100);
    second.getBoundingClientRect = () => rect(100, 1100);
    formula.getBoundingClientRect = vi.fn(() => rect(Number(secondText.getAttribute("data-line-top")) - 10, 26));
    formula.getClientRects = () => [formula.getBoundingClientRect()] as unknown as DOMRectList;
    // Supply line geometry while exercising the real DOM and mutation records.
    const createWalker = document.createTreeWalker.bind(document);
    vi.spyOn(document, "createTreeWalker").mockImplementation(root => createWalker(root, 4));
    let measured: Node;
    const lineRects = vi.fn((node: Node) => [rect(Number(node.parentElement?.getAttribute("data-line-top")), 16)]);
    vi.spyOn(document, "createRange").mockImplementation(() => ({
      selectNodeContents: (node: Node) => { measured = node; },
      setStart() {},
      setEnd() {},
      getClientRects: () => lineRects(measured)
    }) as unknown as Range);
    for (const key of ["Element", "HTMLElement", "Text", "MutationObserver"] as const) vi.stubGlobal(key, window[key]);
    vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1, SHOW_TEXT: 4 });
    Object.defineProperty(document, "fonts", { value: { status: "loaded", ready: Promise.resolve() } });
    const schema = new Schema({ nodes: {
      doc: { content: "question+" }, question: { content: "questionStem" },
      questionStem: { content: "paragraph" }, paragraph: { content: "(text | mathInline)*" },
      mathInline: { inline: true, atom: true }, text: {}
    }});
    const question = (text: string, math = false) => schema.nodes.question.create(null, schema.nodes.questionStem.create(null,
      schema.nodes.paragraph.create(null, math ? [schema.text(text), schema.nodes.mathInline.create()] : [schema.text(text)])));
    let state = EditorState.create({ doc: schema.nodes.doc.create(null, [question("First question"), question("Second question", true)]) });
    const editor = {
      get state() { return state; },
      view: {
        nodeDOM: (pos: number) => pos === 0 ? first : second,
        posAtDOM: (node: Node, offset: number) => (node.parentElement === secondText ? state.doc.firstChild!.nodeSize : 0)
          + 3 + (node === formula ? "Second question".length : offset)
      }
    } as unknown as Editor;
    const paper = createEmptyChalkLeeDocument("试卷");
    try {
      const initial = measureChalkLeePagination(editor, content, paper, 1, "full");
      expect(initial.gaps).toMatchObject([{ pos: state.doc.firstChild!.nodeSize + 3, startPx: 1090 }]);

      lineRects.mockClear();
      vi.mocked(formula.getBoundingClientRect).mockClear();
      state = state.apply(state.tr.insertText("x", 4));
      const edited = measureChalkLeePagination(editor, content, paper, 1, "edit");
      expect(edited.gaps).toMatchObject([{ pos: initial.gaps[0].pos + 1, startPx: 1090 }]);
      expect(lineRects).not.toHaveBeenCalledWith(secondText.firstChild);
      expect(formula.getBoundingClientRect).not.toHaveBeenCalled();

      secondText.setAttribute("data-line-top", "400");
      expect(measureChalkLeePagination(editor, content, paper, 1, "edit")).toEqual({ pageCount: 1, gaps: [] });
    } finally {
      discardChalkLeeFlowMeasurements(content);
      vi.unstubAllGlobals();
    }
  });

  it("replaces question ranges in supplied order and preserves untouched flow items", () => {
    const item = (pos: number) => ({ pos, top: pos, bottom: pos + 1 });
    const items = [30, 20, 5, 10, 29, 8].map(item);
    const body = { from: 8, to: 20, top: 7, bottom: 19 };
    const solution = { from: 20, to: 30, top: 19, bottom: 31 };
    const bodyItem = { pos: 8, top: 7, bottom: 19 };
    const solutionItem = { pos: 20, top: 19, bottom: 31 };
    expect(replaceChalkLeeFlowRanges(items, [body, solution])).toEqual([
      item(30), item(5), bodyItem, solutionItem
    ]);
    const group = { from: 4, to: 20, top: 3, bottom: 19 };
    expect(replaceChalkLeeFlowRanges(items, [body, solution, group])).toEqual([
      item(30), solutionItem, { pos: 4, top: 3, bottom: 19 }
    ]);
    expect(replaceChalkLeeFlowRanges(items, [group, body, solution])).toEqual([
      item(30), { pos: 4, top: 3, bottom: 19 }, bodyItem, solutionItem
    ]);
  });

  it("keeps a page spacer when editing only shifts its position and refreshes it when the margins change", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {}
    } });
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("first and second pages")));
    const plugins = ChalkLeePaginationGapsExtension.config.addProseMirrorPlugins!.call({} as never);
    let state = EditorState.create({ doc, plugins });
    const dispatch = vi.fn((transaction: Transaction) => { state = state.apply(transaction); });
    const editor = { get state() { return state; }, view: { dispatch } } as unknown as Editor;
    const gap = { pos: 8, page: 2, startPx: 900, fillPx: 24, marginTopPx: 80, marginBottomPx: 80, marginLeftPx: 80, marginRightPx: 80, bandPx: 32 };
    setChalkLeePageGaps(editor, [gap]);
    const spacer = () => chalkLeePaginationGapsKey.getState(state)!.decorations.find()[0];
    const originalKey = spacer().spec.key;

    state = state.apply(state.tr.insertText("new ", 2));
    expect(spacer().from).toBe(12);
    setChalkLeePageGaps(editor, [{ ...gap, pos: 12 }]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(spacer().spec.key).toBe(originalKey);

    setChalkLeePageGaps(editor, [{ ...gap, pos: 12, marginLeftPx: 90 }]);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(spacer().spec.key).not.toBe(originalKey);
    expect(state.doc.textContent).toBe("fnew irst and second pages");

    state = state.apply(state.tr.delete(13, state.doc.content.size - 1));
    setChalkLeePageGaps(editor, []);
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(spacer()).toBeUndefined();
  });

  it("counts full sheets from wrapped column rows without a trailing rounding page", () => {
    const height = 1122.52, rowGap = 128, bodyHeight = height + 32 - rowGap;
    expect(chalkLeeColumnPageCount(bodyHeight, height, rowGap)).toBe(1);
    expect(chalkLeeColumnPageCount(bodyHeight + height + 32, height, rowGap)).toBe(2);
    expect(chalkLeeColumnPageCount(bodyHeight + height + 32 + .02, height, rowGap)).toBe(2);
    expect(chalkLeeColumnPageCount(0, height, rowGap)).toBe(1);
  });

  it("identifies changes limited to text in one existing top-level question stem paragraph", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "question+" }, question: { content: "questionStem questionAnswer" },
      questionStem: { content: "paragraph+" }, questionAnswer: { content: "paragraph+" },
      paragraph: { content: "(text|formula)*" }, formula: { inline: true, attrs: { latex: { default: "x" } } }, text: {}
    } });
    const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : []);
    const question = (stem: string, answer: string) => schema.nodes.question.create(null, [
      schema.nodes.questionStem.create(null, paragraph(stem)), schema.nodes.questionAnswer.create(null, paragraph(answer))
    ]);
    const first = question("aaa", "answer");
    const second = question("stem", "answer");
    const document = (...questions: typeof first[]) => schema.nodes.doc.create(null, questions);
    const original = document(first, second);
    expect(chalkLeeEditedTopLevelStem(original, document(question("aaaa", "answer"), second))).toBe(0);
    expect(chalkLeeEditedTopLevelStem(original, document(first, question("new stem", "answer")))).toBe(first.nodeSize);
    expect(chalkLeeEditedTopLevelStem(original, document(question("", "answer"), second))).toBeNull();
    expect(chalkLeeEditedTopLevelStem(original, document(question("aaa", "new answer"), second))).toBeNull();
    expect(chalkLeeEditedTopLevelStem(original, document(question("changed", "answer"), question("changed", "answer")))).toBeNull();
    const withFormula = EditorState.create({ doc: original }).tr.insert(4, schema.nodes.formula.create()).doc;
    expect(chalkLeeEditedTopLevelStem(original, withFormula)).toBeNull();
  });

  it("retains a mapped manual page break and updates it when the number of skipped columns changes", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "(paragraph|pageBreak)+" }, paragraph: { content: "text*" }, pageBreak: {}, text: {}
    } });
    const paragraph = schema.nodes.paragraph.create(null, schema.text("start"));
    const doc = schema.nodes.doc.create(null, [paragraph, schema.nodes.pageBreak.create(), paragraph]);
    const plugins = ChalkLeePaginationGapsExtension.config.addProseMirrorPlugins!.call({} as never);
    let state = EditorState.create({ doc, plugins });
    const dispatch = vi.fn((transaction: Transaction) => { state = state.apply(transaction); });
    const editor = { get state() { return state; }, view: { dispatch } } as unknown as Editor;
    const skips = () => chalkLeePaginationGapsKey.getState(state)!.decorations.find();
    const pos = paragraph.nodeSize + 1;
    expect(setChalkLeeColumnPageBreaks(editor, [{ pos, emptyColumns: 1 }])).toBe(true);
    const originalSkip = skips()[0].spec.key;

    state = state.apply(state.tr.insertText("x", 2));
    expect(skips()[0].from).toBe(pos + 1);
    expect(setChalkLeeColumnPageBreaks(editor, [{ pos: pos + 1, emptyColumns: 1 }])).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);

    expect(setChalkLeeColumnPageBreaks(editor, [{ pos: pos + 1, emptyColumns: 2 }])).toBe(true);
    expect(skips()[0].spec.key).not.toBe(originalSkip);
    expect(setChalkLeeColumnPageBreaks(editor, [{ pos: pos + 1, emptyColumns: 0 }])).toBe(true);
    expect(skips()).toHaveLength(0);
    expect(setChalkLeeColumnPageBreaks(editor, [])).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("skips just the unused columns at manual page breaks", () => {
    expect(chalkLeeColumnsRemaining(-30, 200, 32, 3)).toBe(2);
    expect(chalkLeeColumnsRemaining(232, 200, 32, 3)).toBe(1);
    expect(chalkLeeColumnsRemaining(464, 200, 32, 3)).toBe(0);
  });

  it("places an explicit page gap after an atomic page break instead of dropping it", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      text: {},
      pageBreak: { group: "block", atom: true }
    } });
    const paragraph = schema.nodes.paragraph.create(null, schema.text("第一页"));
    const doc = schema.nodes.doc.create(null, [paragraph, schema.nodes.pageBreak.create(), paragraph]);
    const breakPosition = paragraph.nodeSize;
    const pos = chalkLeeNodeEndPositionAt(doc, breakPosition, "pageBreak");
    expect(pos).toBe(breakPosition + 1);
    expect(chalkLeeNodeEndPositionAt(doc, breakPosition + 1, "pageBreak")).toBe(breakPosition + 1);
    expect(chalkLeeNodeEndPositionAt(doc, 1, "pageBreak")).toBeNull();
    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 24 },
      { pos: pos!, top: 48, bottom: 48, forced: true },
      { pos: pos! + 1, top: 48, bottom: 72 }
    ], 100)).toEqual([{ pos, startPx: 48, fillPx: 52 }]);
  });

  it("switches the current page at the visual midpoint of a paper gap", () => {
    const gapMidpoint = (page: number) => [469, 1360][page - 2];

    expect(currentChalkLeeViewportPage(170, 500, 3, gapMidpoint)).toBe(1);
    expect(currentChalkLeeViewportPage(170, 862, 3, gapMidpoint)).toBe(2);
    expect(currentChalkLeeViewportPage(123, 814, 3, gapMidpoint)).toBe(2);
    expect(currentChalkLeeViewportPage(1100, 1700, 3, gapMidpoint)).toBe(3);
  });

  it("keeps nested image and solution page breaks at their own boundaries", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "questionGroup+" },
      questionGroup: { content: "paragraph questionSolution+" },
      questionSolution: { content: "questionAnswer" },
      questionAnswer: { content: "(paragraph | image | blockMath)+" },
      paragraph: { content: "text*" }, text: {}, image: { atom: true }, blockMath: { atom: true }
    } });
    const paragraph = schema.nodes.paragraph.create(null, schema.text("解题过程"));
    const answer = schema.nodes.questionAnswer.create(null, [paragraph, schema.nodes.image.create(), schema.nodes.blockMath.create()]);
    const solution = schema.nodes.questionSolution.create(null, answer);
    const doc = schema.nodes.doc.create(null, schema.nodes.questionGroup.create(null, [paragraph, solution]));
    const positions: Record<string, number> = {};
    doc.descendants((node, pos) => { positions[node.type.name] = pos; });

    expect(chalkLeeNodeStartPositionAt(doc, positions.image)).toBe(positions.image);
    expect(chalkLeeNodeStartPositionAt(doc, positions.blockMath)).toBe(positions.blockMath);
    expect(chalkLeeNodeStartPositionAt(doc, positions.questionSolution + 1)).toBe(positions.questionSolution);
    expect(chalkLeeNodeStartPositionAt(doc, positions.paragraph + 1)).toBe(positions.paragraph);
  });

  it("locates a page in a long document without reading every sheet", () => {
    const gapMidpoint = vi.fn((page: number) => (page - 1) * 800 - 10);
    expect(currentChalkLeeViewportPage(0, 700, 1, gapMidpoint)).toBe(1);
    expect(gapMidpoint).not.toHaveBeenCalled();
    expect(currentChalkLeeViewportPage(433_000, 433_700, 1000, gapMidpoint)).toBe(542);
    expect(gapMidpoint.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("continues ruled answer lines without moving the preceding question prompt", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "question+" },
      question: { content: "questionStem" },
      questionStem: { content: "paragraph answerLines" },
      paragraph: { content: "text*" },
      answerLines: { content: "answerLine+" },
      answerLine: { content: "text*" },
      text: {}
    } });
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "question", content: [{
      type: "questionStem", content: [
        { type: "paragraph", content: [{ type: "text", text: "Write a letter." }] },
        { type: "answerLines", content: [{ type: "answerLine" }, { type: "answerLine" }] }
      ]
    }] }] });
    const linePositions: number[] = [];
    doc.descendants((node, pos) => { if (node.type.name === "answerLine") linePositions.push(pos); });
    const breakPosition = chalkLeeNodeStartPositionAt(doc, linePositions[1] + 1);
    expect(breakPosition).toBe(linePositions[1]);
    expect(paginateChalkLeeFlow([
      { pos: 2, top: 0, bottom: 60 },
      { pos: linePositions[0], top: 60, bottom: 92 },
      { pos: breakPosition, top: 92, bottom: 124 }
    ], 100)).toMatchObject([{ pos: linePositions[1], startPx: 92, fillPx: 8 }]);
  });

  it("moves the first overflowing line and fills the unused page tail", () => {
    const items: ChalkLeePaginationFlowItem[] = [
      { pos: 1, top: 0, bottom: 24 },
      { pos: 2, top: 72, bottom: 96 },
      { pos: 3, top: 96, bottom: 120 },
      { pos: 4, top: 168, bottom: 192 },
      { pos: 5, top: 192, bottom: 216 }
    ];

    expect(paginateChalkLeeFlow(items, 100)).toEqual([
      { pos: 3, startPx: 96, fillPx: 4 },
      { pos: 5, startPx: 192, fillPx: 4 }
    ]);
  });

  it("keeps an option's letter on the page of its opening text", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "option+" }, option: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {}
    } });
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "option", content: [{
      type: "paragraph", content: [{ type: "text", text: "An option." }]
    }] }] });
    // posAtDOM on a React option can resolve at its first paragraph's boundary.
    expect(chalkLeeNodeStartPositionAt(doc, 1, "option")).toBe(0);
    const flow = [{ pos: 1, top: 0, bottom: 90 }, { pos: 12, top: 98, bottom: 110 }, { pos: 18, top: 110, bottom: 122 }];
    const withMarker = keepChalkLeeOptionMarkersWithContent(flow, [{ from: 10, to: 25, top: 96 }]);
    expect(paginateChalkLeeFlow(withMarker, 100)).toMatchObject([{ pos: 10, startPx: 96 }]);
    expect(flow[1].pos).toBe(12);
  });

  it("still breaks inside a long option after its letter and opening text", () => {
    const withMarker = keepChalkLeeOptionMarkersWithContent([
      { pos: 1, top: 0, bottom: 70 }, { pos: 12, top: 80, bottom: 90 }, { pos: 18, top: 90, bottom: 110 }
    ], [{ from: 10, to: 25, top: 78 }]);
    expect(paginateChalkLeeFlow(withMarker, 100)).toMatchObject([{ pos: 18, startPx: 90 }]);
  });

  it("finds option openings by visual position while keeping flow order and explicit breaks", () => {
    const items = [
      { pos: 33, top: 20, bottom: 20, forced: true },
      { pos: 15, top: 34, bottom: 46 },
      { pos: 18, top: 25, bottom: 36 },
      { pos: 36, top: 23, bottom: 35 },
      { pos: 40, top: 44, bottom: 56 }
    ];
    expect(keepChalkLeeOptionMarkersWithContent(items, [
      { from: 10, to: 30, top: 22 }, { from: 30, to: 40, top: 18 }
    ])).toEqual([items[0], items[1], { pos: 10, top: 22, bottom: 36 }, items[3], items[4]]);
    expect(items[2].pos).toBe(18);
  });

  it("starts each later page from the snapped line instead of a global multiple", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      pos: index + 1,
      top: index * 24,
      bottom: index * 24 + 24
    }));

    expect(paginateChalkLeeFlow(items, 100).map((item) => item.startPx)).toEqual([96, 192]);
  });

  it("honors an explicit break even when the content still fits", () => {
    const items: ChalkLeePaginationFlowItem[] = [
      { pos: 1, top: 0, bottom: 24 },
      { pos: 2, top: 48, bottom: 48, forced: true },
      { pos: 3, top: 48, bottom: 72 }
    ];

    expect(paginateChalkLeeFlow(items, 100)).toEqual([
      { pos: 2, startPx: 48, fillPx: 52 }
    ]);
  });

  it("moves a page-sized question as one atomic flow item instead of splitting its first lines", () => {
    const items: ChalkLeePaginationFlowItem[] = [
      { pos: 1, top: 0, bottom: 70 },
      { pos: 20, top: 70, bottom: 150 },
      { pos: 40, top: 150, bottom: 165 }
    ];

    expect(paginateChalkLeeFlow(items, 100)).toEqual([
      { pos: 20, startPx: 70, fillPx: 30 }
    ]);
  });

  it("absorbs whitespace that naturally extends a little beyond the page edge", () => {
    const items: ChalkLeePaginationFlowItem[] = [
      { pos: 1, top: 0, bottom: 24 },
      { pos: 2, top: 105, bottom: 129 }
    ];

    expect(paginateChalkLeeFlow(items, 100)).toEqual([
      { pos: 2, startPx: 105, fillPx: -5 }
    ]);
  });

  it("does not loop when a single item is taller than a page", () => {
    expect(paginateChalkLeeFlow([{ pos: 1, top: 0, bottom: 240 }], 100)).toEqual([]);
  });

  it("preserves a table-row break so the renderer can create a valid table widget", () => {
    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 60, kind: "table", tableColumns: 3 },
      { pos: 2, top: 60, bottom: 120, kind: "table", tableColumns: 3 }
    ], 100)).toEqual([
      { pos: 2, startPx: 60, fillPx: 40, kind: "table", tableColumns: 3 }
    ]);
  });

  it("breaks a table longer than half a page between rows and keeps shorter ones whole, also for print", () => {
    const { document } = parseHTML(`<div id="content">
      <table data-chalklee-table id="short"><tbody><tr><td>a</td></tr></tbody></table>
      <table data-chalklee-table id="half" data-pagination-whole="true"><tbody><tr><td>b</td></tr><tr class="chalklee-page-gap chalklee-page-gap-table" id="gap"><td></td></tr></tbody></table>
      <section data-pagination-keep-together="true"><table data-chalklee-table id="kept"><tbody><tr><td>c</td></tr></tbody></table></section>
      <table data-chalklee-table id="shrunk"><tbody><tr><td>d</td></tr><tr class="chalklee-page-gap chalklee-page-gap-table" id="old-gap"><td></td></tr></tbody></table>
    </div>`);
    const height = (id: string, value: number) => { document.getElementById(id)!.getBoundingClientRect = () => ({ height: value }) as DOMRect; };
    height("short", 450); height("half", 900); height("gap", 300); height("kept", 600); height("shrunk", 700); height("old-gap", 300);
    const long = chalkLeeLongTables(document.getElementById("content") as unknown as HTMLElement, 1, 1000);
    // A page gap drawn inside a table does not make it longer.
    expect([...long].map(table => table.id)).toEqual(["half"]);
    expect(["short", "half", "kept", "shrunk"].map(id => document.getElementById(id)!.getAttribute("data-pagination-whole"))).toEqual(["true", null, "true", "true"]);
  });

  it("keeps room for a framed box's printed edges on every page it runs onto", () => {
    const frame = { pos: 50, top: 100, bottom: 300, topInsetPx: 16, bottomInsetPx: 14 };
    expect(keepChalkLeeFrameEdges([
      { pos: 1, top: 0, bottom: 90 },
      { pos: 52, top: 116, bottom: 136 },
      { pos: 60, top: 136, bottom: 156 },
      { pos: 70, top: 260, bottom: 286 }
    ], [frame])).toEqual([
      { pos: 1, top: 0, bottom: 90 },
      // A page beginning at the frame's first line starts before the frame.
      { pos: 50, top: 100, bottom: 150 },
      { pos: 60, top: 136, bottom: 170, frameTopPx: 16 },
      { pos: 70, top: 260, bottom: 300, frameTopPx: 16 }
    ]);
    // A page beginning inside the frame has its top edge to fit as well.
    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 90 },
      { pos: 60, top: 90, bottom: 120, frameTopPx: 16 },
      { pos: 70, top: 120, bottom: 180 }
    ], 100).map(({ pos, startPx }) => ({ pos, startPx }))).toEqual([{ pos: 60, startPx: 90 }, { pos: 70, startPx: 120 }]);
  });

  it("starts a page before a table, not before its first row", () => {
    const schema = new Schema({ nodes: {
      doc: { content: "table+" }, table: { content: "tableRow+" }, tableRow: { content: "tableCell+" },
      tableCell: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {}
    } });
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{
      type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "单词" }] }]
    }] }] }] });
    // posAtDOM on the table element inside its node view resolves just inside the table, where its first row starts.
    expect(chalkLeeNodeStartPositionAt(doc, 1)).toBe(1);
    expect(chalkLeeNodeStartPositionAt(doc, 1, "table")).toBe(0);
  });

  it("moves a long table whole when a page would begin at its first row", () => {
    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 80 },
      { pos: 12, top: 80, bottom: 110, kind: "table", tableColumns: 3, tableGroup: "table-a", tableStart: 10 },
      { pos: 20, top: 110, bottom: 140, kind: "table", tableColumns: 3, tableGroup: "table-a" }
    ], 100)).toEqual([{ pos: 10, startPx: 80, fillPx: 20 }]);
    // Header rows never stand alone at a page's bottom: a page beginning at the first body row takes the table.
    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 70 },
      { pos: 12, top: 70, bottom: 90, kind: "table", tableGroup: "table-a", tableStart: 10 },
      { pos: 20, top: 90, bottom: 130, kind: "table", tableGroup: "table-a", tableStart: 10 },
      { pos: 28, top: 130, bottom: 170, kind: "table", tableGroup: "table-a" }
    ], 100)).toEqual([{ pos: 10, startPx: 70, fillPx: 30 }]);
    // A heading kept with the table's header row moves with the table.
    const opening = keepChalkLeeHeadingsWithNext([
      { pos: 1, top: 0, bottom: 60 },
      { pos: 5, top: 62, bottom: 74 },
      { pos: 12, top: 76, bottom: 92, kind: "table", tableGroup: "table-a", tableStart: 10 },
      { pos: 20, top: 92, bottom: 130, kind: "table", tableGroup: "table-a", tableStart: 10 },
      { pos: 28, top: 130, bottom: 160, kind: "table", tableGroup: "table-a" }
    ], [{ from: 4, to: 10 }], 100);
    expect(paginateChalkLeeFlow(opening, 100)).toEqual([{ pos: 4, startPx: 62, fillPx: 38 }]);
    // A merged region that opens the table moves with the whole table too.
    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 60 },
      { pos: 12, top: 60, bottom: 90, kind: "table", tableGroup: "table-a", breakAllowed: true, tableStart: 10 },
      { pos: 20, top: 90, bottom: 120, kind: "table", tableGroup: "table-a", breakAllowed: false }
    ], 100)).toEqual([{ pos: 10, startPx: 60, fillPx: 40 }]);
  });

  it("reserves repeated-header height on every table continuation page", () => {
    const tableHeader = { rows: [], heightPx: 20, signature: "header-a" };
    const breaks = paginateChalkLeeFlow(Array.from({ length: 8 }, (_, index) => ({
      pos: index + 1,
      top: index * 30,
      bottom: index * 30 + 30,
      kind: "table" as const,
      tableColumns: 3,
      tableGroup: "table-a",
      tableHeader: index === 0 ? undefined : tableHeader
    })), 100);

    expect(breaks.map(({ pos, startPx, tableHeader: repeated }) => ({
      pos,
      startPx,
      repeated: repeated?.signature ?? null
    }))).toEqual([
      { pos: 4, startPx: 90, repeated: "header-a" },
      { pos: 6, startPx: 150, repeated: "header-a" },
      { pos: 8, startPx: 210, repeated: "header-a" }
    ]);
  });

  it("moves a vertically merged table region as a unit", () => {
    const breakAllowed = tableRowBreakAvailability([
      [1, 1],
      [2, 1],
      [1],
      [1, 1]
    ]);
    expect(breakAllowed).toEqual([true, true, false, true]);

    expect(paginateChalkLeeFlow([
      { pos: 1, top: 0, bottom: 40, kind: "table", tableGroup: "table-a", breakAllowed: breakAllowed[0] },
      { pos: 2, top: 40, bottom: 80, kind: "table", tableGroup: "table-a", breakAllowed: breakAllowed[1] },
      { pos: 3, top: 80, bottom: 120, kind: "table", tableGroup: "table-a", breakAllowed: breakAllowed[2] },
      { pos: 4, top: 120, bottom: 160, kind: "table", tableGroup: "table-a", breakAllowed: breakAllowed[3] }
    ], 100).map(({ pos, startPx }) => ({ pos, startPx }))).toEqual([
      { pos: 2, startPx: 40 },
      { pos: 4, startPx: 120 }
    ]);
  });

  it("treats rowspan zero as spanning through the final row", () => {
    expect(tableRowBreakAvailability([[0], [1], [1]])).toEqual([true, false, false]);
  });
});


describe("stable pagination", () => {
  it("measures without the current page spacers and always restores them", () => {
    const { document } = parseHTML("<div class='chalklee-editor-content'><span class='chalklee-page-gap'></span></div>");
    const content = document.querySelector(".chalklee-editor-content") as unknown as HTMLElement;
    expect(measureWithoutChalkLeePageGaps(content, () => content.classList.contains("chalklee-pagination-measuring"))).toBe(true);
    expect(content.classList.contains("chalklee-pagination-measuring")).toBe(false);
    expect(() => measureWithoutChalkLeePageGaps(content, () => { throw new Error("layout"); })).toThrow("layout");
    expect(content.classList.contains("chalklee-pagination-measuring")).toBe(false);
  });
  it("holds the breaks on screen when they would flip back and forth, and follows any real change", () => {
    let time = 0;
    const settle = createChalkLeePaginationSettler(() => time);
    const doc = {}, layout = [doc, "paper", 800, 1];
    expect(settle(layout, "A")).toBe(true);
    time = 16; expect(settle(layout, "B")).toBe(true);
    // Measured from B, the breaks would return to A, and from A to B again: keep B.
    time = 32; expect(settle(layout, "A")).toBe(false);
    time = 5000; expect(settle(layout, "A")).toBe(false);
    expect(settle(layout, "B")).toBe(true);
    // An image that finishes loading gives a third result: applied at once.
    expect(settle(layout, "C")).toBe(true);
    // A change made later is not a flip: answers hidden then shown again re-measures each time.
    time = 9000; expect(settle(layout, "B")).toBe(true);
    // Editing, page settings, view options, width or zoom start over.
    time = 9010; expect(settle([{}, "paper", 800, 1], "C")).toBe(true);
    expect(settle([doc, "paper hide-answers", 800, 1], "B")).toBe(true);
  });
});

describe("question group pagination", () => {
  it("starts a long passage in the remaining space with its heading and instructions", () => {
    const flow: ChalkLeePaginationFlowItem[] = [
      { pos: 1, top: 0, bottom: 30 },
      { pos: 11, top: 30, bottom: 34 },
      { pos: 21, top: 34, bottom: 38 },
      ...Array.from({ length: 8 }, (_, index) => ({ pos: 31 + index, top: 38 + index * 10, bottom: 48 + index * 10 })),
      { pos: 60, top: 118, bottom: 134 }
    ];
    const groups = [{ from: 30, to: 90, top: 38, bottom: 134 }];
    const grouped = keepChalkLeeShortGroupsTogether(flow, groups, 100).sort((a, b) => a.top - b.top);
    const withHeadings = keepChalkLeeHeadingsWithNext(grouped, [{ from: 10, to: 20 }, { from: 20, to: 30 }], 100);
    const breaks = paginateChalkLeeFlow(withHeadings, 100);
    expect(breaks).toMatchObject([{ pos: 37, startPx: 98, fillPx: 2 }]);
    expect(withHeadings[1]).toMatchObject({ pos: 10, top: 30, bottom: 48 });
    expect(withHeadings.at(-1)).toEqual({ pos: 60, top: 118, bottom: 134 });
  });

  it("still moves a compact group together when it does not fit the page tail", () => {
    const flow = [{ pos: 1, top: 0, bottom: 80 }, { pos: 21, top: 80, bottom: 90 }, { pos: 31, top: 90, bottom: 110 }];
    const grouped = keepChalkLeeShortGroupsTogether(flow, [{ from: 20, to: 50, top: 80, bottom: 110 }], 100)
      .sort((a, b) => a.top - b.top);
    expect(paginateChalkLeeFlow(grouped, 100)).toMatchObject([{ pos: 20, startPx: 80, fillPx: 20 }]);
    expect(flow).toHaveLength(3);
  });

  it("preserves a manual break inside an otherwise compact group", () => {
    const flow = [{ pos: 1, top: 0, bottom: 10 }, { pos: 11, top: 10, bottom: 10, forced: true }, { pos: 21, top: 10, bottom: 30 }];
    const grouped = keepChalkLeeShortGroupsTogether(flow, [{ from: 0, to: 30, top: 0, bottom: 30 }], 100);
    expect(paginateChalkLeeFlow(grouped, 100)).toMatchObject([{ pos: 11, startPx: 10, fillPx: 90 }]);
  });
});

describe("headings follow their content", () => {
  it("moves a trailing heading with the next short question", () => {
    const flow = [{ pos: 1, top: 0, bottom: 60 }, { pos: 11, top: 70, bottom: 88 }, { pos: 21, top: 90, bottom: 140 }];
    const grouped = keepChalkLeeHeadingsWithNext(flow, [{ from: 10, to: 20 }], 100);
    expect(paginateChalkLeeFlow(grouped, 100).map(item => item.pos)).toEqual([10]);
    expect(flow).toHaveLength(3);
  });
  it("preserves explicit breaks and does not make an oversized unit", () => {
    const heading = { pos: 11, top: 70, bottom: 88 };
    const forced = [heading, { pos: 21, top: 90, bottom: 90, forced: true }, { pos: 22, top: 90, bottom: 110 }];
    expect(keepChalkLeeHeadingsWithNext(forced, [{ from: 10, to: 20 }], 100)).toEqual(forced);
    const oversized = [heading, { pos: 21, top: 90, bottom: 220 }];
    expect(keepChalkLeeHeadingsWithNext(oversized, [{ from: 10, to: 20 }], 100)).toEqual(oversized);
  });


});
