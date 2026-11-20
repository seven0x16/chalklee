import { describe, expect, it, vi } from "vitest";
import type { PreparedImport, SourceFragmentEdit } from "../../shared/conversion/types";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
import { appendSourceRevisions, workingReferenceInput } from "./referenceSources";

const source = (): PreparedImport => ({ sourcePath: "lesson.docx", sourceHash: "immutable-source", page: importAppearance().page, warnings: [], units: [{
  id: "part_1", label: "第1部分", nativeReferences: true,
  blocks: [{ type: "paragraph", attrs: { id: "s1" }, content: [
    { type: "text", text: "1. 己知 ", marks: [{ type: "bold" }] },
    { type: "imageInline", attrs: { id: "im", assetId: "eq", widthPt: 40 } },
    { type: "text", text: "，求其值。" }
  ] }], images: [{ id: "eq", dataUrl: "data:image/png;base64,ZXE=", widthPt: 40, heightPt: 20 }]
}] });
const typo: SourceFragmentEdit = { ref: "s1", path: ["content", 0], kind: "typo", before: "己知", after: "已知", reason: "修正明确的中文错别字" };
const formula: SourceFragmentEdit = { ref: "s1", path: ["content", 1], kind: "image-formula", before: "eq", after: "\\frac{1}{2}", reason: "完整原图只包含二分之一的分式", evidenceImageId: "eq" };

describe("working source revisions", () => {
  it("preserves original content and IDs while replaying local text and image-formula changes", () => {
    const input = source(), original = structuredClone(input);
    const revisions = appendSourceRevisions(input, [], [typo, formula], () => true);
    const working = workingReferenceInput(input, JSON.parse(JSON.stringify(revisions)));
    expect(input).toEqual(original);
    expect(working.units[0].blocks[0].attrs.id).toBe("s1");
    expect(importText({ content: working.units[0].blocks })).toContain("已知");
    expect((working.units[0].blocks[0] as any).content[0].marks).toEqual([{ type: "bold" }]);
    expect((working.units[0].blocks[0] as any).content[1]).toEqual({ type: "mathInline", attrs: { latex: "\\frac{1}{2}" } });
    expect(working.units[0].images).toEqual(original.units[0].images);
    expect(revisions[1]).toMatchObject({ unitId: "part_1", before: "eq", after: "\\frac{1}{2}", evidenceHash: expect.any(String) });
    expect(revisions[0].originalBlock).toEqual(original.units[0].blocks[0]);
  });

  it("does not apply any changes when a later operation has a stale value or invalid formula", () => {
    const input = source(), original = structuredClone(input);
    expect(() => appendSourceRevisions(input, [], [typo, { ...formula, before: "unknown" }], () => true)).toThrow("before");
    expect(input).toEqual(original);
    expect(() => appendSourceRevisions(input, [], [{ ...formula, after: "\\frac{" }], () => true)).toThrow("LaTeX");
    const revisions = appendSourceRevisions(input, [], [typo], () => true);
    expect(() => appendSourceRevisions(input, revisions, [typo], () => true)).toThrow("before");
  });

  it("requires a viewed complete image and refuses missing or unrelated evidence, naming what to look at", () => {
    expect(() => appendSourceRevisions(source(), [], [formula], () => false)).toThrow("请先查看对应原图 eq（完整原图");
    expect(() => appendSourceRevisions(source(), [], [{ ...formula, evidenceImageId: undefined }], () => true)).toThrow("识图修订须写明 evidenceImageId");
    const input = source(); input.units[0].images.push({ ...input.units[0].images[0], id: "unrelated" });
    expect(() => appendSourceRevisions(input, [], [{ ...formula, evidenceImageId: "unrelated" }], () => true)).toThrow("unrelated 不在 s1 中");
    // A figure printed on another page (a diagram below the question's text) points to this page's own image.
    input.units[0].images.push({ ...input.units[0].images[0], id: "part_1" });
    const recognition: SourceFragmentEdit = { ...typo, kind: "recognition", before: "己知", after: "已知", evidenceImageId: "page_16_figure_1" };
    expect(() => appendSourceRevisions(input, [], [recognition], () => true)).toThrow(`page_16_figure_1 不在 s1 所在的原稿页上，不能作为它的原图依据：改用 s1 所在这一页的原稿 evidenceImageId:"part_1"`);
    expect(appendSourceRevisions(input, [], [{ ...recognition, evidenceImageId: "part_1" }], () => true)).toHaveLength(1);
    let requestedFull = false;
    appendSourceRevisions(input, [], [formula], (_unit, _image, full) => { requestedFull = full; return true; });
    expect(requestedFull).toBe(true);
  });

  it("rejects a changed source or image when resuming persisted revisions", () => {
    const input = source();
    const revisions = appendSourceRevisions(input, [], [typo, formula], () => true);
    const changedText = structuredClone(input); (changedText.units[0].blocks[0] as any).content[0].text += "新内容";
    expect(() => workingReferenceInput(changedText, revisions)).toThrow(/原始片段|来源/);
    const changedImage = structuredClone(input); changedImage.units[0].images[0].dataUrl = "data:image/png;base64,bmV3";
    expect(() => workingReferenceInput(changedImage, revisions)).toThrow("原图依据缺失或已变化");
    expect(() => workingReferenceInput(input, [{ ...revisions[0], after: "任意重写" }])).toThrow();
  });

  it("limits typo corrections and protects question labels, symbols, English options and source metadata", () => {
    for (const edit of [
      { ...typo, before: "1", after: "2" },
      { ...typo, after: "不知" },
      { ...typo, before: "word", after: "word." },
      { ...typo, before: "prefer)", after: "(prefer)" },
      { ...typo, path: ["attrs", "id"], before: "s1", after: "s2" },
      { ...typo, path: ["__proto__", "x"] }
    ]) expect(() => appendSourceRevisions(source(), [], [edit], () => true)).toThrow();
    const choice = source(); (choice.units[0].blocks[0] as any).content[0].text = "A. 己知";
    expect(() => appendSourceRevisions(choice, [], [typo], () => true)).toThrow("选项");
    const missing = source(); (missing.units[0].blocks[0] as any).content[0].text = "1. [待核对]原稿缺图";
    expect(() => appendSourceRevisions(missing, [], [{ ...typo, before: "核", after: "" }], () => true)).toThrow("待核对提示");
    const pdf = source(); pdf.units[0].page = 1; pdf.units[0].images.push({ ...pdf.units[0].images[0], id: "part_1" });
    expect(() => appendSourceRevisions(pdf, [], [{ ...typo, kind: "recognition", before: "1.", after: "2.", evidenceImageId: "part_1" }], () => true)).toThrow("题号");
  });

  it("allows an evidenced formula correction without treating the amended content as a missing native formula", () => {
    const input = source(); input.units[0].page = 1;
    input.units[0].images.push({ ...input.units[0].images[0], id: "part_1" });
    (input.units[0].blocks[0] as any).content[1] = { type: "mathInline", attrs: { latex: "a-b" } };
    const edit: SourceFragmentEdit = { ref: "s1", path: ["content", 1], kind: "recognition", before: "a-b", after: "a+b", reason: "原页清晰显示两项之间为加号", evidenceImageId: "part_1" };
    const revisions = appendSourceRevisions(input, [], [edit], () => true);
    expect(importText({ content: workingReferenceInput(input, revisions).units[0].blocks })).toContain("a+b");
    expect(importText({ content: input.units[0].blocks })).toContain("a-b");
  });

  it("converts formula images inside table cells and standalone blocks without replacing their surrounding content", () => {
    const input = source(), paragraph = input.units[0].blocks[0];
    input.units[0].blocks = [{ type: "table", attrs: { id: "table" }, content: [{ type: "tableRow", attrs: { id: "row" }, content: [{ type: "tableCell", attrs: { id: "cell" }, content: [paragraph as any] }] }] },
      { type: "image", attrs: { id: "standalone", assetId: "eq", widthPt: 40 } }];
    const revisions = appendSourceRevisions(input, [], [
      { ...formula, ref: "table", path: ["content", 0, "content", 0, "content", 0, "content", 1] },
      { ...formula, ref: "standalone", path: [] }
    ], () => true);
    const working = workingReferenceInput(input, revisions);
    expect((working.units[0].blocks[0] as any).content[0].content[0].content[0].content[1].type).toBe("mathInline");
    expect(working.units[0].blocks[1]).toEqual({ type: "blockMath", attrs: { id: "standalone", latex: "\\frac{1}{2}" } });
    expect(importText({ content: working.units[0].blocks })).toContain("，求其值。");
    expect(input.units[0].blocks[1].type).toBe("image");
  });
});
