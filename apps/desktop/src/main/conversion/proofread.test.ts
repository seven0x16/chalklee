import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive } from "@chalklee/format";
import type { ChalkLeeDocument } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import type { ImportRecord } from "../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../shared/contracts";
vi.mock("electron", () => ({ nativeImage: {} }));
vi.mock("../settings/ai", () => ({ getAiCredentials: vi.fn() }));
import { applyProofread, mergeProofread } from "./proofread";

const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (id: string, value: string, marks?: unknown[]) => ({ type: "paragraph", attrs: { id }, content: [text(value, marks)] });
const question = (id: string, number: string, stem: string, image?: string, marks?: unknown[]) => ({ type: "question", attrs: { id, kind: "solution", number: { mode: "fixed", label: number } },
  content: [{ type: "questionStem", attrs: { id: `${id}-stem` }, content: [paragraph(`${id}-p`, stem, marks), ...(image ? [{ type: "image", attrs: { id: `${id}-image`, assetId: image, widthPt: 100, heightPt: 50 } }] : [])] }] });
const paper = (blocks: any[]): ChalkLeeDocument => {
  const document = createEmptyChalkLeeDocument("试卷");
  document.id = "document_00000000-0000-4000-8000-000000000001";
  document.content.content = blocks as any;
  document.provenance = { method: "import", sources: [{ id: "original", type: "pdf", fileName: "试卷.pdf", sha256: "a".repeat(64) }], anchors: [] };
  return document;
};
const side = (document: ChalkLeeDocument, assets: Record<string, Uint8Array> = {}) => ({ document, bytes: (id: string) => assets[id], assets: Object.entries(assets).map(([id, data]) => ({ id, path: `assets/${id}.png`, mediaType: "image/png", data })) });
const blocks = (document: ChalkLeeDocument) => document.content.content as any[];
const stemText = (block: any) => block.content[0].content[0].content[0].text;
const ids = (document: ChalkLeeDocument) => blocks(document).map(block => block.attrs.id);

describe("merging a proofread into the teacher's draft", () => {
  it("takes every correction when the teacher left the draft as it was, keeping ids", () => {
    const draft = paper([paragraph("title", "期中试卷"), question("q1", "1", "计算 $a-b$"), question("q2", "2", "第二题"), { type: "heading", attrs: { id: "extra", level: 2 }, content: [text("页眉")] }]);
    const proofread = paper([paragraph("t-title", "期中试卷"), question("t-q1", "1", "计算 $a+b$"), question("t-q2", "2", "第二题"), paragraph("t-note", "补上的说明")]);
    proofread.appearance = { ...proofread.appearance, body: { ...proofread.appearance.body, fontSizePt: 12 } };
    const merge = mergeProofread(side(draft), side(proofread), side(structuredClone(draft)));
    expect(ids(merge.document)).toEqual(["title", "q1", "q2", "t-note"]);
    expect(stemText(blocks(merge.document)[1])).toBe("计算 $a+b$");
    // The revised question keeps its own ids inside, so selections and the question basket still find it.
    expect(blocks(merge.document)[1].content[0].attrs.id).toBe("q1-stem");
    expect(merge).toMatchObject({ applied: 3, kept: [] });
    expect(merge.ids.get("t-q1")).toBe("q1"); expect(merge.ids.get("t-q2")).toBe("q2");
    expect(merge.document.appearance.body.fontSizePt).toBe(12);
  });

  it("keeps a question the teacher changed, without mistaking the editor's own normalisation for an edit", () => {
    const bold = [{ type: "bold" }, { type: "textStyle", attrs: { fontSizePt: 12 } }];
    const draft = paper([question("q1", "1", "计算 $a-b$"), question("q2", "2", "如图", "fig", bold)]);
    const teacher = structuredClone(draft);
    blocks(teacher)[0].content[0].content[0].content[0].text = "计算 $a-b$（老师改过）";
    // Saved by the editor: marks reordered, defaults filled in, and a tag the teacher added.
    const saved = blocks(teacher)[1];
    saved.attrs.tags = ["几何"];
    saved.content[0].content[0].content[0].marks = [...bold].reverse();
    Object.assign(saved.content[0].content[1].attrs, { layout: "block", textAlign: "center" });
    const proofread = paper([question("t-q1", "1", "计算 $a+b$"), question("t-q2", "2", "如图所示", "fig", bold)]);
    const figure = { fig: new Uint8Array([1]) };
    const merge = mergeProofread(side(draft, figure), side(proofread, figure), side(teacher, figure));
    expect(stemText(blocks(merge.document)[0])).toBe("计算 $a-b$（老师改过）");
    expect(stemText(blocks(merge.document)[1])).toBe("如图所示");
    expect(blocks(merge.document)[1].attrs).toMatchObject({ id: "q2", tags: ["几何"] });
    expect(merge).toMatchObject({ applied: 1, kept: ["q1"] });
  });

  it("does not report a correction the teacher already made", () => {
    const draft = paper([question("q1", "1", "计算 $a-b$")]);
    const teacher = paper([question("q1", "1", "计算 $a+b$")]);
    const merge = mergeProofread(side(draft), side(paper([question("t-q1", "1", "计算 $a+b$")])), side(teacher));
    expect(merge).toMatchObject({ applied: 0, kept: [] });
  });

  it("follows the teacher's order and additions, and gives a re-cropped figure its own picture", () => {
    const draft = paper([question("q1", "1", "如图", "fig"), question("q2", "2", "第二题")]);
    const teacher = paper([paragraph("mine", "老师加的说明"), question("q2", "2", "第二题"), question("q1", "1", "如图", "fig")]);
    const proofread = paper([question("t-q1", "1", "如图", "fig"), question("t-q2", "2", "第二题"), question("t-q3", "3", "漏掉的第三题")]);
    const before = new Uint8Array([1, 2, 3]), after = new Uint8Array([4, 5, 6]);
    const merge = mergeProofread(side(draft, { fig: before }), side(proofread, { fig: after }), side(teacher, { fig: before }));
    expect(ids(merge.document)).toEqual(["mine", "q2", "t-q3", "q1"]);
    const image = blocks(merge.document)[3].content[0].content[1].attrs;
    expect(image.assetId).toMatch(/^fig_[0-9a-f]{8}$/);
    expect(merge.assets).toEqual([expect.objectContaining({ id: image.assetId, path: `assets/${image.assetId}.png`, data: after })]);
  });
});

describe("writing a proofread into the converted document", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  it("updates the teacher's file in place, keeps the draft as a version and records what is left to check", async () => {
    root = await mkdtemp(path.join(tmpdir(), "cm-proofread-"));
    const draft = paper([question("q1", "1", "计算 $a-b$"), question("q2", "2", "如图", "fig")]);
    const figure = { id: "fig", path: "assets/fig.png", mediaType: "image/png", data: new Uint8Array([1]) };
    const history = path.join(root, ".chalklee", "history", draft.id);
    await mkdir(history, { recursive: true });
    await writeFile(path.join(history, "initial.chalklee"), await createChalkLeeArchive(draft, [figure]));
    const existing = { documentId: draft.id, sourceName: "试卷.pdf", sourcePath: ".chalklee/sources/a.pdf", sourceHash: "a".repeat(64), model: "test", createdAt: draft.metadata.createdAt,
      warnings: [], questionCount: 2, unitCount: 1, conversion: { strategy: "autonomous-v1", status: "converted", proofread: "pending", structureModel: "test", cachedUnits: 0,
        calls: [{ stage: "document-agent", model: "test", input: 1, output: 1, cacheRead: 0, totalTokens: 10 }] } } satisfies ImportRecord;
    await writeFile(path.join(history, "import.json"), JSON.stringify(existing));
    const teacher = structuredClone(draft);
    blocks(teacher)[0].content[0].content[0].content[0].text = "计算 $a-b$（老师改过）";
    const filePath = path.join(root, "试卷.chalklee");
    await writeFile(filePath, await createChalkLeeArchive(teacher, [figure]));
    const file: WorkspaceFileNode = { kind: "file", id: filePath, fileId: filePath, path: filePath, name: "试卷.chalklee", extension: "chalklee", size: 1, modifiedAt: 1, status: "unparsed" };
    const proofread = paper([question("t-q1", "1", "计算 $a+b$"), question("t-q2", "2", "如图所示", "fig")]);
    const changed = vi.fn();
    const result = await applyProofread({ root, file, by: "ChalkLee AI", changed }, {
      document: proofread, assets: [figure], notices: [{ message: "第2题图中字母不清，请核对", nodeId: "t-q2-p" }],
      record: { ...existing, conversion: { ...existing.conversion, proofread: "done", calls: [{ stage: "agent-source-review", model: "test", input: 1, output: 1, cacheRead: 0, totalTokens: 5 }] } }
    });
    expect(result).toMatchObject({ applied: 1, kept: 1 });
    expect(changed).toHaveBeenCalledWith(filePath, "changed");
    const saved = await readChalkLeeArchive(await readFile(filePath));
    expect(saved.document.id).toBe(draft.id);
    expect(blocks(saved.document).map(stemText)).toEqual(["计算 $a-b$（老师改过）", "如图所示"]);
    const record = JSON.parse(await readFile(path.join(history, "import.json"), "utf8")) as ImportRecord;
    expect(record.conversion).toMatchObject({ proofread: "done", calls: [{ totalTokens: 10 }, { totalTokens: 5 }] });
    expect(record.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "第2题图中字母不清，请核对", questionIds: ["q2"] }),
      expect.objectContaining({ questionIds: ["q1"], message: expect.stringContaining("保留了你的版本") })
    ]));
    const versions = JSON.parse(await readFile(path.join(history, "versions.json"), "utf8"));
    expect(JSON.stringify(versions)).toContain("ChalkLee AI 校对前");
  });
});
