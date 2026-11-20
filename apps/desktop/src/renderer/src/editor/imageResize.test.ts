import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo, undoDepth } from "@tiptap/pm/history";
import { EditorState, NodeSelection, type Transaction } from "@tiptap/pm/state";
import { createChalkLeeArchive, readChalkLeeArchive } from "@chalklee/format";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeImageNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { createEmptyChalkLeeDocument } from "./editing";
import { chalkLeeImageSizeTransaction, constrainChalkLeeImageSize, resizeChalkLeeImage, type ChalkLeeImageResizeGeometry } from "./imageResize";

const geometry: ChalkLeeImageResizeGeometry = {
  widthPt: 240, heightPt: 120, scale: 1, maxWidthPt: 450, maxHeightPt: 700, alignment: "left"
};
const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeImageNode]);

describe("ChalkLee image resizing", () => {
  it.each([.5, .92, 1, 1.5, 2])("converts pointer travel at zoom %s into document points", scale => {
    expect(resizeChalkLeeImage({ ...geometry, scale }, "se", 80 * scale, 40 * scale)).toEqual({ widthPt: 300, heightPt: 150 });
  });

  it("uses the centered edge's actual travel and reverses left/top handles", () => {
    expect(resizeChalkLeeImage({ ...geometry, alignment: "center" }, "se", 40, 0).widthPt).toBe(300);
    expect(resizeChalkLeeImage(geometry, "nw", -80, -40)).toEqual({ widthPt: 300, heightPt: 150 });
    expect(resizeChalkLeeImage(geometry, "ne", 0, -40).widthPt).toBe(300);
    expect(resizeChalkLeeImage(geometry, "sw", -80, 0).widthPt).toBe(300);
  });

  it("clamps to cell width and page height without changing the image ratio", () => {
    expect(constrainChalkLeeImageSize({ ...geometry, maxWidthPt: 90 }, 400)).toEqual({ widthPt: 90, heightPt: 45 });
    expect(constrainChalkLeeImageSize({ ...geometry, widthPt: 100, heightPt: 500, maxHeightPt: 600 }, 300)).toEqual({ widthPt: 120, heightPt: 600 });
    expect(constrainChalkLeeImageSize(geometry, -100)).toEqual({ widthPt: 24, heightPt: 12 });
    expect(constrainChalkLeeImageSize({ ...geometry, maxWidthPt: 12 }, -100)).toEqual({ widthPt: 12, heightPt: 6 });
    expect(constrainChalkLeeImageSize({ ...geometry, widthPt: 240, heightPt: 10 }, 120)).toEqual({ widthPt: 120, heightPt: 5 });
  });

  it("isolates a gesture from adjacent text edits and subsequent resizing in undo/redo", () => {
    let state = EditorState.create({ schema, plugins: [history()], doc: schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("正文")),
      schema.nodes.image.create({ id: "image-1", assetId: "asset-1", caption: "说明", widthPt: 240, heightPt: 120 }),
      schema.nodes.image.create({ id: "image-2", widthPt: 90, heightPt: 90 })
    ]) });
    const apply = (transaction: Transaction) => { state = state.apply(transaction); };
    apply(state.tr.insertText("新增", 1));
    const position = state.doc.firstChild!.nodeSize;
    apply(chalkLeeImageSizeTransaction(state, position, { widthPt: 300, heightPt: 150 })!);
    apply(closeHistory(state.tr));
    expect(undoDepth(state)).toBe(2);
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(state.doc.nodeAt(position)?.attrs.caption).toBe("说明");
    expect(state.doc.lastChild?.attrs.widthPt).toBe(90);
    apply(state.tr.insertText("后续", 1));
    expect(undoDepth(state)).toBe(3);
    undo(state, apply);
    undo(state, apply);
    expect(state.doc.nodeAt(position)?.attrs.widthPt).toBe(240);
    expect(state.doc.firstChild?.textContent).toBe("新增正文");
    redo(state, apply);
    expect(state.doc.nodeAt(position)?.attrs.widthPt).toBe(300);
    apply(chalkLeeImageSizeTransaction(state, position, { widthPt: 360, heightPt: 180 })!);
    undo(state, apply);
    expect(state.doc.nodeAt(position)?.attrs.widthPt).toBe(300);
  });

  it("ignores invalid sizes, unchanged dimensions and a target that is no longer an image", () => {
    const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create(), schema.nodes.image.create({ widthPt: 240, heightPt: 120 })]) });
    expect(chalkLeeImageSizeTransaction(state, 0, { widthPt: 300, heightPt: 150 })).toBeNull();
    expect(chalkLeeImageSizeTransaction(state, 2, { widthPt: NaN, heightPt: 150 })).toBeNull();
    expect(chalkLeeImageSizeTransaction(state, 2, { widthPt: 0, heightPt: 150 })).toBeNull();
    expect(chalkLeeImageSizeTransaction(state, 2, { widthPt: 240, heightPt: 120 })).toBeNull();
  });

  it("saves and reopens fractional dimensions and preserves all image metadata", async () => {
    const document = createEmptyChalkLeeDocument("缩放图片");
    const attrs = { id: "image-1", assetId: "asset-1", widthPt: 273.38, heightPt: 136.69, caption: "示意图", alt: "矩形", textAlign: "right" as const };
    document.content.content.push({ type: "image", attrs });
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document));
    expect(archive.document.content.content.at(-1)?.attrs).toEqual(attrs);
    const reopened = schema.nodeFromJSON(archive.document.content.content.at(-1)!);
    expect(reopened.attrs.widthPt).toBe(273.38);
    expect(reopened.attrs.heightPt).toBe(136.69);
  });
});
