import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeePageAppearance, type ChalkLeeRootNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument, sanitizeChalkLeeEditorJson } from "./editing";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeMarginPreset, chalkLeePageSettingsTransaction } from "./pageSettings";
import { chalkLeeColumnLayout, chalkLeePageSizePt } from "./pagination";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
function setup() {
  const document = createEmptyChalkLeeDocument("纸张测试");
  document.content = { type: "doc", content: [{ type: "paragraph", attrs: { id: "body" }, content: [{ type: "text", text: "现有内容" }] }] };
  const doc = schema.nodeFromJSON({ ...document.content, attrs: { runtimePage: document.appearance.page } });
  const state = EditorState.create({ schema, doc, plugins: [history()], selection: TextSelection.atStart(doc) });
  return { document, state };
}

describe("editable paper properties", () => {
  it("defaults older documents to one column and calculates A3 column widths", () => {
    const { document } = setup();
    expect(chalkLeeColumnLayout(document.appearance.page).count).toBe(1);
    expect(chalkLeeColumnLayout(document.appearance.page).gapPt).toBe(24);
    const page = { ...document.appearance.page, size: "A3", orientation: "landscape", columnCount: 3, columnGapPt: 30 } as ChalkLeePageAppearance;
    expect(chalkLeeColumnLayout(page).widthPt).toBeCloseTo((1190.55 - page.marginsPt.left - page.marginsPt.right - 60) / 3);
  });

  it("saves and reopens columns and spacing, retaining caret, content and undo", async () => {
    let { document, state } = setup();
    const original = state.doc;
    state = state.apply(closeHistory(chalkLeePageSettingsTransaction(state, { size: "A3", orientation: "landscape", columnCount: 4, columnGapPt: 18 })!));
    const page = state.doc.attrs.runtimePage as ChalkLeePageAppearance;
    expect(state.doc.content.eq(original.content)).toBe(true);
    expect(state.selection.from).toBe(1);
    const saved = { ...document, appearance: { ...document.appearance, page }, content: sanitizeChalkLeeEditorJson(state.doc.toJSON()) as ChalkLeeRootNode };
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(saved, []));
    expect(archive.document.appearance.page).toMatchObject({ columnCount: 4, columnGapPt: 18 });
    expect(validateChalkLeeSemantics(archive.document, archive.manifest)).toEqual([]);
    expect(JSON.stringify(archive.document.content)).not.toContain("column");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.attrs.runtimePage).toEqual(page);
  });

  it("rejects invalid counts, gaps and layouts too narrow to edit", () => {
    const { state } = setup();
    for (const columnCount of [0, -1, 1.5, NaN, Infinity, 13]) expect(chalkLeePageSettingsTransaction(state, { columnCount })).toBeNull();
    for (const columnGapPt of [-1, NaN, Infinity]) expect(chalkLeePageSettingsTransaction(state, { columnGapPt })).toBeNull();
    expect(chalkLeePageSettingsTransaction(state, { columnCount: 2, columnGapPt: 1000 })).toBeNull();
    const wide = state.apply(chalkLeePageSettingsTransaction(state, { size: "A3", orientation: "landscape", columnCount: 8 })!);
    expect(chalkLeePageSettingsTransaction(wide, { size: "A4", orientation: "portrait" })).toBeNull();
    expect(chalkLeePageSettingsTransaction(wide, { columnCount: 1 })?.doc.attrs.runtimePage.columnCount).toBe(1);
  });

  it("updates page layout without moving the caret or changing question content", () => {
    const { state } = setup();
    const transaction = chalkLeePageSettingsTransaction(state, { orientation: "landscape", size: "A3" })!;
    expect(transaction.docChanged).toBe(true);
    expect(transaction.selection.eq(state.selection)).toBe(true);
    expect(transaction.doc.content.eq(state.doc.content)).toBe(true);
    expect(chalkLeePageSizePt(transaction.doc.attrs.runtimePage)).toEqual({ width: 1190.55, height: 841.89 });
    expect(transaction.doc.attrs.runtimePage.marginsPt).toEqual(state.doc.attrs.runtimePage.marginsPt);
  });

  it("undoes page changes independently of text edits and redoes them in order", () => {
    let { state } = setup();
    const initialPage = state.doc.attrs.runtimePage;
    state = state.apply(closeHistory(chalkLeePageSettingsTransaction(state, { orientation: "landscape" })!));
    state = state.apply(closeHistory(state.tr.insertText("正文")));
    const edited = state.doc;
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.textContent).not.toContain("正文");
    expect(state.doc.attrs.runtimePage.orientation).toBe("landscape");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.attrs.runtimePage).toEqual(initialPage);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(edited)).toBe(true);
  });

  it("persists actual page appearance while omitting the editor's runtime attribute", async () => {
    const { document, state } = setup();
    const next = state.apply(chalkLeePageSettingsTransaction(state, { marginsPt: { left: 36 }, background: { type: "solid", color: "#fffaf0" }, printBackground: false })!);
    const saved = { ...document, appearance: { ...document.appearance, page: next.doc.attrs.runtimePage as ChalkLeePageAppearance }, content: sanitizeChalkLeeEditorJson(next.doc.toJSON()) as ChalkLeeRootNode };
    expect(JSON.stringify(saved.content)).not.toContain("runtimePage");
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(saved, []));
    expect(archive.document.appearance.page).toEqual(next.doc.attrs.runtimePage);
    expect(archive.document.content).toEqual(document.content);
    expect(validateChalkLeeSemantics(archive.document, archive.manifest)).toEqual([]);
  });

  it("preserves custom margins, supports partial changes, and rejects unusable values", () => {
    const { state } = setup();
    const custom = chalkLeePageSettingsTransaction(state, { marginsPt: { top: 42 } })!;
    const page = custom.doc.attrs.runtimePage as ChalkLeePageAppearance;
    expect(page.marginsPt).toEqual({ ...state.doc.attrs.runtimePage.marginsPt, top: 42 });
    expect(chalkLeeMarginPreset(page)).toBe("custom");
    expect(chalkLeeMarginPreset({ ...page, marginsPt: { top: 36, right: 36, bottom: 36, left: 36 } })).toBe("narrow");
    for (const top of [-1, NaN, Infinity, 10000]) expect(chalkLeePageSettingsTransaction(state, { marginsPt: { top } })).toBeNull();
    expect(chalkLeePageSettingsTransaction(state, {})).toBeNull();
  });

  it("retains image backgrounds through layout changes and restores them on undo", () => {
    let { state } = setup();
    const background = { type: "image", assetId: "paper", fit: "cover", opacity: .5, fallbackColor: "#fff" } as const;
    state = state.apply(chalkLeePageSettingsTransaction(state, { background })!);
    state = state.apply(closeHistory(chalkLeePageSettingsTransaction(state, { orientation: "landscape" })!));
    expect(state.doc.attrs.runtimePage.background).toEqual(background);
    state = state.apply(closeHistory(chalkLeePageSettingsTransaction(state, { background: { type: "solid", color: "#fffaf0" } })!));
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.attrs.runtimePage.background).toEqual(background);
    expect(state.doc.attrs.runtimePage.orientation).toBe("landscape");
  });
});
