import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics } from "@chalklee/format";
import { ChalkLeeDocumentNode, ChalkLeeImageNode, ChalkLeeInlineImageNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeImageLayoutTransaction, chalkLeeImagePairs, chalkLeeNudgeImageTransaction, chalkLeeMoveImageTransaction, chalkLeePairImagesTransaction, chalkLeeRepairImagePairs, findChalkLeeImage } from "./imageLayout";
import { CHALKLEE_IMAGE_LAYOUT_EVENT, chalkLeeImagePairPlugin, observeChalkLeeImageSlot } from "./imagePairs";
import { createEmptyChalkLeeDocument, regenerateChalkLeeNodeIds, sanitizeChalkLeeEditorJson } from "./editing";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeImageNode, ChalkLeeInlineImageNode, ...chalkLeeStructuralExtensions]);
const p = (text = "", id = "p") => schema.nodes.paragraph.create({ id, textAlign: "right" }, text ? schema.text(text) : undefined);
const img = (id = "img") => schema.nodes.image.create({ id, assetId: "asset", widthPt: 120, heightPt: 60, caption: "示意图" });
const q = (id: string) => schema.nodes.question.create({ id }, schema.nodes.questionStem.create({ id: `${id}-stem` }, [p("题干", `${id}-p`), img(`${id}-img`)]));
const stateFor = (...children: Parameters<typeof schema.nodes.doc.create>[1][]) => EditorState.create({ schema, plugins: [history(), chalkLeeImagePairPlugin()], doc: schema.nodes.doc.create(null, children.flat() as never) });
const apply = (state: EditorState, tr: Transaction | null) => { expect(tr).not.toBeNull(); return state.apply(tr!); };

it("follows current pairing slots after suspension, replacement and unmount", () => {
  const { document, window } = parseHTML("<main><div data-image-pair><i data-chalklee-image-slot='one'></i></div><b data-chalklee-image-slot='two'></b></main>");
  const content = document.querySelector("main") as unknown as HTMLElement;
  const pair = content.firstElementChild as HTMLElement;
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });
  const paint = () => { const next = frame; frame = undefined; next?.(0); };
  const announce = () => content.dispatchEvent(new window.Event(CHALKLEE_IMAGE_LAYOUT_EVENT));
  const one = vi.fn(), two = vi.fn();
  const stopOne = observeChalkLeeImageSlot(content, "one", one);
  const stopTwo = observeChalkLeeImageSlot(content, "two", two);
  try {
    paint();
    expect(one).toHaveBeenLastCalledWith(pair.firstElementChild);
    expect(two).toHaveBeenLastCalledWith(content.lastElementChild);
    pair.dataset.suspended = "true";
    announce(); paint();
    expect(one).toHaveBeenLastCalledWith(null);

    delete pair.dataset.suspended;
    pair.innerHTML = "<em data-chalklee-image-slot='one'></em>";
    stopTwo();
    announce(); paint();
    expect(one).toHaveBeenLastCalledWith(pair.firstElementChild);
    expect(two).toHaveBeenCalledTimes(2);
  } finally {
    stopOne();
    stopTwo();
    vi.unstubAllGlobals();
  }
});

describe("image flow and ownership", () => {
  it("embeds into preceding text, moves between characters, splits back preserving text/format/metadata and undo", () => {
    let state = stateFor(p("甲乙丙"), img());
    const original = state.doc;
    state = apply(state, chalkLeeImageLayoutTransaction(state, "img", "inline"));
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.firstChild!.lastChild!.type.name).toBe("imageInline");
    state = state.apply(closeHistory(state.tr));
    state = apply(state, chalkLeeMoveImageTransaction(state, "img", 2));
    expect(state.doc.firstChild!.child(0).text).toBe("甲");
    state = state.apply(closeHistory(state.tr));
    state = apply(state, chalkLeeImageLayoutTransaction(state, "img", "block"));
    expect(state.doc.childCount).toBe(3);
    expect(state.doc.child(0).textContent).toBe("甲");
    expect(state.doc.child(2).textContent).toBe("乙丙");
    expect(state.doc.child(0).attrs.textAlign).toBe("right");
    expect(state.doc.child(2).attrs.textAlign).toBe("right");
    expect(state.doc.child(0).attrs.id).not.toBe(state.doc.child(2).attrs.id);
    expect(state.doc.child(1).attrs.assetId).toBe("asset");
    expect(state.doc.child(1).attrs.caption).toBe("示意图");
    const dispatch = (tr: Transaction) => { state = state.apply(tr); };
    undo(state, dispatch); undo(state, dispatch); undo(state, dispatch);
    expect(state.doc.eq(original)).toBe(true);
    redo(state, dispatch);
    expect(findChalkLeeImage(state.doc, "img")!.node.type.name).toBe("imageInline");
  });

  it("wraps the preceding paragraph within its original question", () => {
    let state = stateFor(q("a"), q("b"));
    state = apply(state, chalkLeeImageLayoutTransaction(state, "b-img", "wrap-right"));
    expect(state.doc.firstChild!.eq(q("a"))).toBe(true);
    expect(state.doc.lastChild!.firstChild!.firstChild!.attrs.id).toBe("b-img");
    expect(findChalkLeeImage(state.doc, "b-img")!.node.attrs.layout).toBe("wrap-right");
  });

  it("creates a paragraph for a lone image and converts back without empty extra paragraphs", () => {
    let state = stateFor(img());
    state = apply(state, chalkLeeImageLayoutTransaction(state, "img", "inline"));
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    state = apply(state, chalkLeeImageLayoutTransaction(state, "img", "block"));
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.firstChild!.type.name).toBe("image");
  });

  it("pairs adjacent questions without moving assets; detaches an orphan after deletion and preserves undo", () => {
    let state = stateFor(q("a"), q("b"), q("c"));
    state = apply(state, chalkLeePairImagesTransaction(state, "b-img", "a-img"));
    expect(chalkLeeImagePairs(state.doc)).toHaveLength(1);
    expect(state.doc.firstChild!.firstChild!.lastChild!.attrs.id).toBe("a-img");
    const paired = state.doc;
    state = state.apply(closeHistory(state.tr).delete(state.doc.firstChild!.nodeSize, state.doc.firstChild!.nodeSize + state.doc.child(1).nodeSize));
    expect(chalkLeeRepairImagePairs(state)).toBeNull();
    expect(findChalkLeeImage(state.doc, "a-img")!.node.attrs.imagePairId).toBeNull();
    // Repairs are part of the deletion's history event.
    undo(state, tr => { state = state.apply(tr); });
    expect(state.doc.eq(paired)).toBe(true);
  });

  it("rejects nonadjacent, same-question and framed pairs; clears copied row references", () => {
    let state = stateFor(q("a"), p("隔开"), q("b"));
    expect(chalkLeePairImagesTransaction(state, "a-img", "b-img")).toBeNull();
    expect(chalkLeePairImagesTransaction(state, "a-img", "a-img")).toBeNull();
    state = stateFor(q("a"), q("b"));
    state = state.apply(state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild!.attrs, runtimeFrame: { design: "box" } }));
    expect(chalkLeePairImagesTransaction(state, "a-img", "b-img")).toBeNull();
    state = stateFor(q("a"), q("b"));
    state = apply(state, chalkLeePairImagesTransaction(state, "a-img", "b-img"));
    const copy = regenerateChalkLeeNodeIds(state.doc.firstChild!.toJSON());
    expect(copy.content![0].content![1].attrs!.imagePairId).toBeUndefined();
    expect(copy.content![0].content![1].attrs!.assetId).toBe("asset");
  });

  it("re-pairs without leaving multiple rows on a question and repairs nonadjacency", () => {
    let state = stateFor(q("a"), q("b"), q("c"));
    state = apply(state, chalkLeePairImagesTransaction(state, "a-img", "b-img"));
    state = apply(state, chalkLeePairImagesTransaction(state, "b-img", "c-img"));
    expect(findChalkLeeImage(state.doc, "a-img")!.node.attrs.imagePairId).toBeNull();
    expect(chalkLeeImagePairs(state.doc)[0].images.map(i => i.node.attrs.id)).toEqual(["b-img", "c-img"]);
    state = state.apply(state.tr.insert(state.doc.child(0).nodeSize + state.doc.child(1).nodeSize, p("隔开")));
    expect(chalkLeeRepairImagePairs(state)).toBeNull();
    expect(chalkLeeImagePairs(state.doc)).toHaveLength(0);
  });

  it("keeps images reachable by keyboard and refuses moves outside the document", () => {
    let state = stateFor(p("甲"), img(), p("乙", "next"));
    state = apply(state, chalkLeeNudgeImageTransaction(state, "img", -1));
    expect(state.doc.firstChild!.attrs.id).toBe("img");
    expect(chalkLeeNudgeImageTransaction(state, "img", -1)).toBeNull();
    state = apply(state, chalkLeeNudgeImageTransaction(state, "img", 1));
    expect(state.doc.child(1).attrs.id).toBe("img");
    expect(chalkLeeMoveImageTransaction(state, "img", -1)).toBeNull();
  });

  it.each(["image", "imageInline"])("preserves %s clipboard metadata without copying row membership", type => {
    const { document } = parseHTML("<html><body></body></html>");
    const node = schema.nodes[type].create({ ...img().attrs, src: "data:image/png;base64,AAAA", imagePairId: "pair-source" });
    const parent = type === "imageInline" ? schema.nodes.paragraph.create(null, node) : node;
    const dom = DOMSerializer.fromSchema(schema).serializeNode(parent, { document: document as never });
    document.body.appendChild(dom as never);
    const parsed = DOMParser.fromSchema(schema).parse(document.body as never);
    const image = findChalkLeeImage(parsed, "img")!.node;
    expect(image.attrs.assetId).toBe("asset");
    expect(image.attrs.widthPt).toBe(120);
    expect(image.attrs.caption).toBe("示意图");
    expect(image.attrs.src).toBe("data:image/png;base64,AAAA");
    expect(image.attrs.layout).toBe(type === "image" ? null : "block");
    expect(image.attrs.imagePairId).toBeNull();
    expect(image.type.name).toBe(type);
  });

  it("round-trips inline, wrap and paired attributes; semantic validation checks inline assets/ids", async () => {
    let state = stateFor(q("a"), q("b"), p("正文", "body"), img("inline"), img("wrap"));
    state = apply(state, chalkLeePairImagesTransaction(state, "a-img", "b-img"));
    state = apply(state, chalkLeeImageLayoutTransaction(state, "inline", "inline"));
    state = apply(state, chalkLeeImageLayoutTransaction(state, "wrap", "wrap-left"));
    const document = createEmptyChalkLeeDocument("图片排版");
    document.content = sanitizeChalkLeeEditorJson(state.doc.toJSON()) as typeof document.content;
    const reopened = await readChalkLeeArchive(await createChalkLeeArchive(document));
    const doc = schema.nodeFromJSON(reopened.document.content);
    expect(doc.eq(state.doc)).toBe(true);
    expect(validateChalkLeeSemantics(reopened.document)).toEqual([]);
    expect(validateChalkLeeSemantics(reopened.document, reopened.manifest).some(i => i.code === "missing-asset" && i.path.includes("content"))).toBe(true);
  });
});
