import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeDocument, type ChalkLeeManifest } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import type { QuestionSnapshot } from "../../../shared/questionBank/search";
import { Schema } from "@tiptap/pm/model";
import { createQuestionPaper, prepareQuestionInsertion, questionInsertionAnchorPosition } from "./questionInsertion";

const sha = (character: string) => character.repeat(64);
const bytes = (value: number) => new Uint8Array([value, value, value]).buffer;
const paragraph = (id: string, text: string) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });

function snapshot(relativePath: string, questionId: string, node: QuestionSnapshot["node"], assets: QuestionSnapshot["assets"] = []): QuestionSnapshot {
  return { location: { path: `/w/${relativePath}`, relativePath, documentTitle: relativePath, questionId, number: "7", contentHash: "h" }, contentHash: "h", node, assets };
}

const choice = (id: string, styleRef?: string, assetId?: string): QuestionSnapshot["node"] => ({
  type: "question",
  attrs: { id, kind: "choice", number: { mode: "fixed", label: "7" }, score: 3, tags: ["函数"], ...(styleRef ? { styleRef } : {}) },
  content: [
    { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, "题干"), ...(assetId ? [{ type: "image", attrs: { id: `${id}_img`, assetId, imagePairId: "pair" } }] : [])] },
    { type: "optionGroup", attrs: { id: `${id}_options`, styleRef: "source-only-options" }, content: [{ type: "option", attrs: { id: `${id}_a`, label: "A" }, content: [paragraph(`${id}_ap`, "甲")] }] },
    { type: "questionAnswer", attrs: { id: `${id}_answer` }, content: [paragraph(`${id}_answerp`, "A")] }
  ]
});

const group: QuestionSnapshot["node"] = {
  type: "questionGroup",
  attrs: { id: "g", kind: "cloze", number: { mode: "auto" } },
  content: [
    { type: "questionMaterial", attrs: { id: "g_m" }, content: [{ type: "paragraph", attrs: { id: "g_mp" }, content: [{ type: "text", text: "材料" }, { type: "blank", attrs: { id: "blank1", label: "1" } }] }] },
    { type: "subQuestionList", attrs: { id: "g_list" }, content: [
      { type: "question", attrs: { id: "s1", kind: "choice", number: { mode: "fixed", label: "1" }, sourceBlankId: "blank1" }, content: [{ type: "questionStem", attrs: { id: "s1_stem" }, content: [paragraph("s1_p", "第一空")] }] },
      { type: "question", attrs: { id: "s2", kind: "choice", number: { mode: "auto" }, sourceBlankId: "elsewhere" }, content: [{ type: "questionStem", attrs: { id: "s2_stem" }, content: [paragraph("s2_p", "外部空")] }] }
    ] }
  ]
};

function target(): { document: ChalkLeeDocument; manifest: ChalkLeeManifest } {
  const document = createEmptyChalkLeeDocument("新卷");
  const styleRef = Object.keys(document.appearance.questionStyles)[0];
  document.content.content = [{ type: "question", attrs: { id: "existing", kind: "choice", number: { mode: "auto" }, styleRef }, content: [{ type: "questionStem", attrs: { id: "existing_stem" }, content: [paragraph("existing_p", "已有题")] }] }] as ChalkLeeDocument["content"]["content"];
  document.provenance = { method: "manual", sources: [{ id: "bank-a", type: "chalklee", fileName: "甲.chalklee", relativePath: "甲.chalklee" }], anchors: [] };
  return { document, manifest: { format: "chalklee", formatVersion: "0.1", mediaType: "application/vnd.chalklee+zip", documentPath: "document.json", documentId: document.id, createdAt: "", updatedAt: "", assets: [{ id: "target-img", path: "assets/target-img.png", mediaType: "image/png", byteLength: 3, sha256: sha("a") }] } as ChalkLeeManifest };
}

describe("question bank insertion", () => {
  it("copies questions as independent, valid snapshots in the target document", () => {
    const destination = target();
    const keptStyle = Object.keys(destination.document.appearance.questionStyles)[0];
    let next = 0;
    const prepared = prepareQuestionInsertion([
      snapshot("甲.chalklee", "q1", choice("q1", keptStyle, "img"), [{ id: "img", path: "assets/img.png", mediaType: "image/png", sha256: sha("a"), data: bytes(1) }]),
      snapshot("乙.chalklee", "q1", choice("q1", "missing-style", "img"), [{ id: "img", path: "assets/img.jpg", mediaType: "image/jpeg", sha256: sha("b"), data: bytes(2) }]),
      snapshot("丙.chalklee", "q9", choice("q9", undefined, "other"), [{ id: "other", path: "assets/other.jpg", mediaType: "image/jpeg", sha256: sha("b"), data: bytes(2) }]),
      snapshot("乙.chalklee", "g", group)
    ], destination, () => `id${++next}`, () => `asset${++next}`);

    const [first, second, third, copiedGroup] = prepared.nodes as any[];
    expect(first.attrs).toMatchObject({ number: { mode: "auto" }, styleRef: keptStyle, score: 3, tags: ["函数"] });
    expect(second.attrs.styleRef).toBeUndefined();
    expect(second.content[1].attrs.styleRef).toBeUndefined();
    // Identical bytes share one asset: the target's own and one new copy for both JPEG questions.
    expect(first.content[0].content[1].attrs.assetId).toBe("target-img");
    expect(prepared.assets.map(asset => [asset.path.endsWith(".jpg"), asset.data[0]])).toEqual([[true, 2]]);
    expect(third.content[0].content[1].attrs.assetId).toBe(second.content[0].content[1].attrs.assetId);
    expect(first.content[0].content[1].attrs.imagePairId).not.toBe("pair");
    expect(copiedGroup.content[1].content[0].attrs.sourceBlankId).toBe(copiedGroup.content[0].content[0].content[1].attrs.id);
    expect(copiedGroup.content[1].content[1].attrs.sourceBlankId).toBeUndefined();
    expect(copiedGroup.content[1].content[0].attrs.number).toEqual({ mode: "fixed", label: "1" });

    expect(prepared.provenance.sources.map(source => source.relativePath)).toEqual(["甲.chalklee", "乙.chalklee", "丙.chalklee"]);
    expect(prepared.provenance.anchors?.map(anchor => [anchor.nodeId, anchor.sourceId === "bank-a", anchor.locator])).toEqual([
      [prepared.questionIds[0], true, { kind: "chalklee", nodeId: "q1" }],
      [prepared.questionIds[1], false, { kind: "chalklee", nodeId: "q1" }],
      [prepared.questionIds[2], false, { kind: "chalklee", nodeId: "q9" }],
      [prepared.questionIds[3], false, { kind: "chalklee", nodeId: "g" }]
    ]);

    const document = { ...destination.document, content: { ...destination.document.content, content: [...destination.document.content.content, ...prepared.nodes] }, provenance: prepared.provenance } as ChalkLeeDocument;
    const manifest = { ...destination.manifest, assets: [...destination.manifest.assets, ...prepared.assets.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, byteLength: asset.data.byteLength, sha256: asset.sha256 }))] };
    expect(validateChalkLeeSemantics(document, manifest)).toEqual([]);
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(new URL("../../../../../../packages/format/schema/document.schema.json", import.meta.url), "utf8")));
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  });

  it("composes a new paper from the basket that saves and reopens with every question and image", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer;
    const paper = createQuestionPaper("组卷 10月23日", [
      snapshot("甲.chalklee", "q1", choice("q1", undefined, "img"), [{ id: "img", path: "assets/img.png", mediaType: "image/png", sha256: sha("c"), data: png }]),
      snapshot("乙.chalklee", "g", group)
    ]);
    const bytes = await createChalkLeeArchive(paper.document, paper.assets.map(({ id, path, mediaType, data }) => ({ id, path, mediaType, data })));
    const reopened = await readChalkLeeArchive(bytes);
    const blocks = reopened.document.content.content as any[];
    expect(blocks.map(block => block.type)).toEqual(["heading", "question", "questionGroup", "paragraph"]);
    expect(blocks[0].content[0].text).toBe("组卷 10月23日");
    expect(blocks.slice(1, 3).map(block => block.attrs.id)).toEqual(paper.questionIds);
    expect(blocks[1].content[0].content[1].attrs.assetId).toBe(paper.assets[0].id);
    expect(reopened.manifest.assets.map(asset => asset.byteLength)).toEqual([7]);
    expect(reopened.document.provenance?.anchors?.map(anchor => anchor.locator)).toEqual([{ kind: "chalklee", nodeId: "q1" }, { kind: "chalklee", nodeId: "g" }]);
    expect(validateChalkLeeSemantics(reopened.document, reopened.manifest)).toEqual([]);
  });

  it("refuses a question whose image is missing from its snapshot", () => {
    expect(() => prepareQuestionInsertion([snapshot("甲.chalklee", "q1", choice("q1", undefined, "img"))], target())).toThrow("题目图片缺失");
  });
});

describe("question insertion anchors", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*", attrs: { id: { default: null } } },
      question: { group: "block", content: "paragraph+", attrs: { id: { default: null } } },
      text: {}
    }
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", { id: "title" }, [schema.text("期中试卷")]),
    schema.node("question", { id: "q1" }, [schema.node("paragraph", { id: "q1_stem" }, [schema.text("第一题")])]),
    schema.node("paragraph", { id: "tail" })
  ]);
  const title = doc.child(0), question = doc.child(1);

  it("places dropped questions before or after the named top-level block", () => {
    expect(questionInsertionAnchorPosition(doc, { beforeId: "title" })).toBe(0);
    expect(questionInsertionAnchorPosition(doc, { afterId: "title" })).toBe(title.nodeSize);
    expect(questionInsertionAnchorPosition(doc, { beforeId: "q1" })).toBe(title.nodeSize);
    expect(questionInsertionAnchorPosition(doc, { afterId: "q1" })).toBe(title.nodeSize + question.nodeSize);
    expect(questionInsertionAnchorPosition(doc, { afterId: "tail" })).toBe(doc.content.size);
  });

  it("does not resolve to blocks nested inside a question or ones already removed", () => {
    expect(questionInsertionAnchorPosition(doc, { afterId: "q1_stem" })).toBeNull();
    expect(questionInsertionAnchorPosition(doc, { beforeId: "deleted" })).toBeNull();
  });
});
