import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, redo, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeOptionAuthoringExtension } from "./extensions/optionAuthoring";
import { isChalkLeeOptionMarkerSpaceKey } from "./extensions/optionMarkers";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ...chalkLeeStructuralExtensions
]);

interface OptionAuthoringStorage {
  physicalSpacePending: boolean;
  composing: boolean;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  optionalMarkerSpace?: {
    paragraphId: string;
    contextIdentity: string;
  };
}

afterEach(() => vi.useRealTimers());

interface OptionAuthoringHarness {
  view: EditorView;
  plugin: Plugin;
  state(): EditorState;
  setComposing(value: boolean): void;
  transactions: Transaction[];
}

describe("typed markers", () => {
  it("structures an out-of-sequence root question as soon as its terminator lands", () => {
    const initial = rootNumberMarker("21");
    const harness = optionAuthoringHarness(initial.doc, initial.markerId);

    expect(typeNativeTextInput(harness, ".")).toBe(true);

    const question = firstQuestion(harness.state().doc);
    expect(question.attrs).toMatchObject({
      kind: "free-response",
      number: { mode: "fixed", label: "21" }
    });
    expect(question.content.content.map((node) => node.type.name)).toEqual(["questionStem"]);
    expect(question.firstChild?.firstChild?.attrs.id).toBe(initial.markerId);
    expect(question.textContent).toBe("");
    expect(harness.state().selection.$from.parent.attrs.id).toBe(initial.markerId);
  });

  it("keeps typed option markers as literal text in stems and options", () => {
    vi.useFakeTimers();
    const stem = questionWithStemMarker("A");
    const stemHarness = optionAuthoringHarness(stem.doc, stem.markerId);
    expect(typeNativeTextInput(stemHarness, ".")).toBe(false);
    expect(typeTriggerSpace(stemHarness)).toBe(false);
    expect(optionLabels(stemHarness.state().doc)).toEqual([]);

    const inline = questionWithSingleOptionText("选项甲 B");
    const inlineHarness = optionAuthoringHarness(inline.doc, inline.paragraphId);
    expect(typeNativeTextInput(inlineHarness, ".")).toBe(false);
    const handlers = optionDomHandlers(inlineHarness.plugin);
    handlers.compositionstart?.call(inlineHarness.plugin, inlineHarness.view, {} as CompositionEvent);
    inlineHarness.setComposing(true);
    inlineHarness.view.dispatch(inlineHarness.state().tr.insertText("。"));
    inlineHarness.setComposing(false);
    handlers.compositionend?.call(inlineHarness.plugin, inlineHarness.view, {} as CompositionEvent);
    vi.runAllTimers();
    expect(optionLabels(inlineHarness.state().doc)).toEqual(["A"]);
    expect(optionTexts(inlineHarness.state().doc)).toEqual(["选项甲 B.。"]);
  });

  it("recognizes a full-width fixed question number after IME composition ends", () => {
    vi.useFakeTimers();
    const initial = rootNumberMarker("２１");
    const harness = optionAuthoringHarness(initial.doc, initial.markerId);
    const handlers = optionDomHandlers(harness.plugin);

    handlers.compositionstart?.call(harness.plugin, harness.view, {} as CompositionEvent);
    harness.setComposing(true);
    harness.view.dispatch(harness.state().tr.insertText("。"));
    harness.setComposing(false);
    handlers.compositionend?.call(harness.plugin, harness.view, {} as CompositionEvent);
    vi.runAllTimers();

    expect(firstQuestion(harness.state().doc).attrs.number).toEqual({ mode: "fixed", label: "21" });
    expect(firstQuestion(harness.state().doc).content.content.map((node) => node.type.name)).toEqual(["questionStem"]);
  });
});

function optionAuthoringHarness(doc: ProseMirrorNode, markerId: string): OptionAuthoringHarness {
  const storage: OptionAuthoringStorage = {
    physicalSpacePending: false,
    composing: false,
    generation: 0,
    timer: null
  };
  const addPlugins = ChalkLeeOptionAuthoringExtension.config.addProseMirrorPlugins as unknown as (
    this: { storage: OptionAuthoringStorage }
  ) => Plugin[];
  const plugin = addPlugins.call({ storage })[0];
  const marker = findNodeById(doc, markerId);
  if (!marker) throw new Error(`Missing marker paragraph ${markerId}`);
  let state = EditorState.create({
    schema,
    doc,
    plugins: [history(), plugin],
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
      state = state.apply(transaction);
    }
  } as unknown as EditorView;
  return {
    view,
    plugin,
    state: () => state,
    setComposing: (value) => { composing = value; },
    transactions
  };
}

function optionDomHandlers(plugin: Plugin) {
  return plugin.props.handleDOMEvents as undefined | {
    compositionstart?: (view: EditorView, event: CompositionEvent) => boolean;
    compositionend?: (view: EditorView, event: CompositionEvent) => boolean;
  } ?? {};
}

function typeTriggerSpace(harness: OptionAuthoringHarness) {
  const position = harness.state().selection.from;
  expect(handleKeyDown(harness, spaceKey() as KeyboardEvent)).toBe(false);
  return handleTextInput(harness, position, position, " ");
}

function typeNativeTextInput(harness: OptionAuthoringHarness, text: string) {
  const position = harness.state().selection.from;
  expect(handleKeyDown(harness, keyEvent(text) as KeyboardEvent)).toBe(false);
  const handled = handleTextInput(harness, position, position, text);
  if (!handled) harness.view.dispatch(harness.state().tr.insertText(text, position, position));
  return handled;
}

function typeNativeSpace(harness: OptionAuthoringHarness) {
  const position = harness.state().selection.from;
  expect(handleKeyDown(harness, spaceKey() as KeyboardEvent)).toBe(false);
  const handled = handleTextInput(harness, position, position, " ");
  if (!handled) harness.view.dispatch(harness.state().tr.insertText(" ", position, position));
  return handled;
}

function handleKeyDown(harness: OptionAuthoringHarness, event: KeyboardEvent) {
  return harness.plugin.props.handleKeyDown?.call(harness.plugin, harness.view, event) ?? false;
}

function handleTextInput(harness: OptionAuthoringHarness, from: number, to: number, text: string) {
  return harness.plugin.props.handleTextInput?.call(
    harness.plugin,
    harness.view,
    from,
    to,
    text,
    () => harness.state().tr.insertText(text, from, to)
  ) ?? false;
}

function replaceLastOptionWithContentAndMarker(
  harness: OptionAuthoringHarness,
  content: string,
  marker: string,
  markerId: string
) {
  const question = firstQuestion(harness.state().doc);
  const optionGroup = question.content.content.find((child) => child.type.name === "optionGroup");
  const lastOption = optionGroup?.lastChild;
  if (!lastOption) throw new Error("Missing current option");
  const optionPosition = findNodePosition(harness.state().doc, lastOption);
  const replacement = lastOption.type.create(lastOption.attrs, [
    schema.nodes.paragraph.create({ id: `${markerId}_content` }, schema.text(content)),
    schema.nodes.paragraph.create({ id: markerId }, schema.text(marker))
  ], lastOption.marks);
  const transaction = harness.state().tr.replaceWith(
    optionPosition,
    optionPosition + lastOption.nodeSize,
    replacement
  );
  const insertedMarker = findNodeById(transaction.doc, markerId);
  if (!insertedMarker) throw new Error("Missing inserted marker");
  transaction.setSelection(TextSelection.create(
    transaction.doc,
    insertedMarker.position + 1 + insertedMarker.node.content.size
  ));
  harness.view.dispatch(transaction);
}

function setSelectionAtParagraphEnd(harness: OptionAuthoringHarness, paragraphId: string) {
  const paragraph = findNodeById(harness.state().doc, paragraphId);
  if (!paragraph) throw new Error(`Missing selection paragraph ${paragraphId}`);
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.create(
    harness.state().doc,
    paragraph.position + 1 + paragraph.node.content.size
  )));
}

function rootNumberMarker(marker: string) {
  const markerId = "root_number_marker";
  return {
    doc: schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create({ id: markerId }, schema.text(marker))
    ),
    markerId
  };
}

function questionWithStemMarker(marker: string) {
  const markerId = "stem_marker";
  const stem = schema.nodes.questionStem.create({ id: "stem" }, [
    schema.nodes.paragraph.create({ id: "stem_text" }, schema.text("题干")),
    schema.nodes.paragraph.create({ id: markerId }, marker ? schema.text(marker) : undefined)
  ]);
  const question = schema.nodes.question.create({
    id: "question",
    kind: "free-response",
    number: { mode: "auto" }
  }, stem);
  return { doc: schema.nodes.doc.create(null, question), markerId };
}

function questionWithOptionsAndMarker(labels: string[], marker: string, layout = "one-column") {
  const markerId = "option_marker";
  const stem = schema.nodes.questionStem.create(
    { id: "stem" },
    schema.nodes.paragraph.create({ id: "stem_text" }, schema.text("题干"))
  );
  const options = labels.map((label, index) => schema.nodes.option.create(
    { id: `option_${label}`, label },
    index === labels.length - 1
      ? [
          schema.nodes.paragraph.create({ id: `option_${label}_text` }, schema.text(`选项${label}`)),
          schema.nodes.paragraph.create({ id: markerId }, schema.text(marker))
        ]
      : schema.nodes.paragraph.create({ id: `option_${label}_text` }, schema.text(`选项${label}`))
  ));
  const optionGroup = schema.nodes.optionGroup.create({ id: "options", layout }, options);
  const question = schema.nodes.question.create({
    id: "question",
    kind: "single-choice",
    number: { mode: "auto" }
  }, [stem, optionGroup]);
  return { doc: schema.nodes.doc.create(null, question), markerId };
}

function questionWithSingleOptionText(text: string, layout = "one-column") {
  const paragraphId = "inline_option_text";
  const stem = schema.nodes.questionStem.create(
    { id: "stem" },
    schema.nodes.paragraph.create({ id: "stem_text" }, schema.text("题干"))
  );
  const option = schema.nodes.option.create(
    { id: "option_A", label: "A" },
    schema.nodes.paragraph.create({ id: paragraphId }, schema.text(text))
  );
  const optionGroup = schema.nodes.optionGroup.create({ id: "options", layout }, option);
  const question = schema.nodes.question.create({
    id: "question",
    kind: "single-choice",
    number: { mode: "auto" }
  }, [stem, optionGroup]);
  return { doc: schema.nodes.doc.create(null, question), paragraphId };
}

function questionWithAdjacentMarker(marker: string, layout = "one-column") {
  const markerId = "adjacent_marker";
  const question = firstQuestion(questionWithSingleOptionText("4", layout).doc);
  return {
    doc: schema.nodes.doc.create(null, [question, schema.nodes.paragraph.create({ id: markerId }, marker ? schema.text(marker) : undefined)]),
    markerId
  };
}

function firstQuestion(doc: ProseMirrorNode) {
  const question = doc.firstChild;
  if (!question || question.type.name !== "question") throw new Error("Missing question");
  return question;
}

function optionLabels(doc: ProseMirrorNode) {
  const group = firstQuestion(doc).content.content.find((child) => child.type.name === "optionGroup");
  return group ? Array.from(group.content.content, (option) => String(option.attrs.label)) : [];
}

function optionTexts(doc: ProseMirrorNode) {
  const group = firstQuestion(doc).content.content.find((child) => child.type.name === "optionGroup");
  return group ? Array.from(group.content.content, (option) => option.textContent) : [];
}

function paragraphText(doc: ProseMirrorNode, id: string) {
  return findNodeById(doc, id)?.node.textContent ?? null;
}

function findNodeById(doc: ProseMirrorNode, id: string): { node: ProseMirrorNode; position: number } | null {
  let result: { node: ProseMirrorNode; position: number } | null = null;
  doc.descendants((node, position) => {
    if (node.attrs.id !== id) return;
    result = { node, position };
    return false;
  });
  return result;
}

function findNodePosition(doc: ProseMirrorNode, target: ProseMirrorNode): number {
  let result: number | null = null;
  doc.descendants((node, position) => {
    if (node !== target) return;
    result = position;
    return false;
  });
  if (result === null) throw new Error("Missing target node");
  return result;
}

function spaceKey(overrides: Partial<KeyboardEvent> = {}) {
  return keyEvent(" ", overrides);
}

function keyEvent(key: string, overrides: Partial<KeyboardEvent> = {}) {
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
