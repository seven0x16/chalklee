import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, type ChalkLeeDocument, type ChalkLeeQuestionNode } from "@chalklee/format";
import { AgentWorkspaceService } from "./workspace";
import { AgentEditorBridge } from "./editorBridge";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { agentDocumentRevision, agentQuestionInventory } from "../../shared/agent/editing";
import { listDocumentVersions, readDocumentVersion } from "../workspace/versions";
import { normalizeQuestionAttributePatch } from "../../shared/questionBank/search";

const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
function question(id: string, label = "1"): ChalkLeeQuestionNode {
  return { type: "question", attrs: { id, kind: "choice", number: { mode: "fixed", label }, score: 2, difficulty: "easy", tags: ["原标签"] }, content: [
    { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, "原题干")] },
    { type: "optionGroup", attrs: { id: `${id}_options`, layout: "two-column" }, content: [
      { type: "option", attrs: { id: `${id}_a`, label: "A" }, content: [paragraph(`${id}_ap`, "原选项")] }
    ] },
    { type: "questionAnswer", attrs: { id: `${id}_answer` }, content: [paragraph(`${id}_answerp`, "原答案")] }
  ] };
}
let root: string, file: string, service: AgentWorkspaceService, document: ChalkLeeDocument;
const changed = vi.fn();
beforeEach(async () => {
  changed.mockClear(); root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-question-edit-"))); file = path.join(root, "试卷.chalklee");
  document = createEmptyChalkLeeDocument("试卷");
  document.content.content = [paragraph("unrelated", "独立正文"), question("q1"), question("q2")];
  await writeFile(file, await createChalkLeeArchive(document));
  service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: path => `http://127.0.0.1/?file=${path}`, changed });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("existing ChalkLee question editing", () => {
  it("lists repeated numbers by stable ID and atomically persists text, formulas, options and own tags", async () => {
    const listing = await service.readQuestions("试卷.chalklee", { includeContent: true });
    expect(listing.questions.map(question => question.id)).toEqual(["q1", "q2"]);
    expect(await service.readQuestions(file, { offset: 1, limit: 1 })).toMatchObject({ total: 2, offset: 1, truncated: false, questions: [{ id: "q2" }] });
    const result = await service.updateQuestions(file, listing.revision, [{ questionId: "q1", patch: { stem: ["新题干 $x^2$", "$$x=2$$"], options: [{ label: "A", content: ["新选项"] }, { label: "B", content: ["B"] }], answer: ["B"], analysis: ["解析"], attrs: { tags: ["代数"], score: 5, difficulty: "hard" } } }]);
    expect(result).toMatchObject({ saved: true, updatedQuestionIds: ["q1"] });
    const saved = (await readChalkLeeArchive(await readFile(file))).document;
    expect(saved.content.content[0]).toEqual(document.content.content[0]);
    expect(saved.content.content[2]).toEqual(document.content.content[2]);
    const edited = saved.content.content[1] as ChalkLeeQuestionNode;
    expect(edited.attrs).toMatchObject({ id: "q1", score: 5, difficulty: "hard", tags: ["代数"] });
    expect(edited.content[0].attrs.id).toBe("q1_stem");
    expect(edited.content[0].content[0]).toMatchObject({ content: [{ type: "text", text: "新题干 " }, { type: "mathInline", attrs: { latex: "x^2" } }] });
    expect(edited.content[0].content[1]).toMatchObject({ type: "blockMath", attrs: { latex: "x=2" } });
    expect(edited.content.find(region => region.type === "optionGroup")).toMatchObject({ attrs: { id: "q1_options", layout: "two-column" }, content: [{ attrs: { id: "q1_a", label: "A" } }, { attrs: { label: "B" } }] });
    expect((await service.readQuestions(file, { query: "代数" })).questions.map(question => question.id)).toEqual(["q1"]);
    expect(changed).toHaveBeenCalledWith(file, "changed");
    await expect(service.updateQuestions(file, listing.revision, [{ questionId: "q2", patch: { answer: ["C"] } }])).rejects.toThrow("版本已变化");
  });
  it("keeps the library's own property edits as the teacher's editing, with tags cleared by null", async () => {
    // The question library edits through the same path, labelled as the teacher's edit rather than an assistant's.
    const library = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, version: { reason: "edit" } });
    const before = await readFile(file);
    await library.updateQuestions(file, undefined, [{ questionId: "q2", patch: { attrs: normalizeQuestionAttributePatch({ tags: [" 函数 ", "函数", ""], difficulty: "medium" }) } }]);
    let saved = (await readChalkLeeArchive(await readFile(file))).document;
    expect((saved.content.content[2] as ChalkLeeQuestionNode).attrs).toMatchObject({ tags: ["函数"], difficulty: "medium", score: 2 });
    // Untouched content stays byte-identical in meaning.
    expect(saved.content.content[1]).toEqual(document.content.content[1]);
    const { versions } = await listDocumentVersions(root, file, await readFile(file));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: "edit", label: "编辑中的版本" });
    expect(Buffer.from(await readDocumentVersion(root, saved.id, versions[0].id)).equals(before)).toBe(true);

    await library.updateQuestions(file, undefined, [{ questionId: "q2", patch: { attrs: normalizeQuestionAttributePatch({ tags: [], score: null }) } }]);
    saved = (await readChalkLeeArchive(await readFile(file))).document;
    expect((saved.content.content[2] as ChalkLeeQuestionNode).attrs).not.toHaveProperty("tags");
    expect((saved.content.content[2] as ChalkLeeQuestionNode).attrs).not.toHaveProperty("score");
    for (const bad of [{}, { tags: "函数" }, { difficulty: "extreme" }, { score: -1 }, { score: Number.NaN }]) expect(() => normalizeQuestionAttributePatch(bad)).toThrow();
    expect(normalizeQuestionAttributePatch({ tags: ["a"], other: "ignored" })).toEqual({ tags: ["a"] });
  });

  it("brings a copy in line from what it holds now, and puts it back unless it has changed since", async () => {
    const library = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, version: { reason: "edit" } });
    const attrsOf = async (id: string) => ((await readChalkLeeArchive(await readFile(file))).document.content.content
      .find(node => (node as ChalkLeeQuestionNode).attrs?.id === id) as ChalkLeeQuestionNode).attrs;
    const change = await library.changeQuestionAttributes({ path: file, questionId: "q1", removeTags: ["原标签"], difficulty: "hard" });
    expect(change).toEqual({ path: file, questionId: "q1", before: { tags: ["原标签"], difficulty: "easy" }, after: { tags: null, difficulty: "hard" } });
    expect(await attrsOf("q1")).toMatchObject({ difficulty: "hard", score: 2 });
    expect(await attrsOf("q1")).not.toHaveProperty("tags");
    // Already in line: nothing is written.
    expect(await library.changeQuestionAttributes({ path: file, questionId: "q1", removeTags: ["原标签"], difficulty: "hard" })).toBeNull();
    expect(await library.restoreQuestionAttributes(change!)).toMatchObject({ kept: false, saved: true });
    expect(await attrsOf("q1")).toMatchObject({ tags: ["原标签"], difficulty: "easy", score: 2 });

    // Changed again after the edit: the newer state stays.
    const second = await library.changeQuestionAttributes({ path: file, questionId: "q2", set: { tags: ["新标签"] } });
    await library.updateQuestions(file, undefined, [{ questionId: "q2", patch: { attrs: { tags: ["老师又改了"] } } }]);
    expect(await library.restoreQuestionAttributes(second!)).toMatchObject({ kept: true });
    expect(await attrsOf("q2")).toMatchObject({ tags: ["老师又改了"] });

    // A copy deleted since has nothing to bring in line; the question being edited must still be there.
    expect(await library.changeQuestionAttributes({ path: file, questionId: "gone", removeTags: ["原标签"] })).toBeNull();
    await expect(library.changeQuestionAttributes({ path: file, questionId: "gone", set: { tags: ["新标签"] } })).rejects.toThrow("题目已不存在");
  });

  it("does not change any bytes when a batch target, option label, asset, or schema is invalid", async () => {
    const original = await readFile(file), { revision } = await service.readQuestions(file);
    for (const edits of [
      [{ questionId: "q1", patch: { answer: ["B"] } }, { questionId: "missing", patch: { answer: ["C"] } }],
      [{ questionId: "q1", patch: { options: [{ label: "A", content: ["1"] }, { label: "A", content: ["2"] }] } }],
      [{ questionId: "q1", patch: { stem: [{ type: "image", attrs: { id: "new", assetId: "missing" } }] } }],
      [{ questionId: "q1", patch: { stem: [{ type: "paragraph", attrs: { id: "p", runtimeStyle: "bad" } }] } }]
    ]) {
      await expect(service.updateQuestions(file, revision, edits as any)).rejects.toThrow();
      expect(await readFile(file)).toEqual(original);
    }
    expect(changed).not.toHaveBeenCalled();
  });
  it("preserves native writing lines, printed text and existing solutions when replacing a stem", async () => {
    const { revision } = await service.readQuestions(file);
    const lines = { type: "answerLines" as const, attrs: { id: "writing_lines", spacingPt: 28 }, content: [
      { type: "answerLine" as const, attrs: { id: "first_line" }, content: [{ type: "text" as const, text: "Printed opening", marks: [{ type: "bold" as const }] }] },
      { type: "answerLine" as const, attrs: { id: "second_line" } },
      { type: "answerLine" as const, attrs: { id: "third_line" } }
    ] };
    await service.updateQuestions(file, revision, [{ questionId: "q1", patch: { stem: [paragraph("opening", "Writing task"), lines] } }]);
    const saved = (await readChalkLeeArchive(await readFile(file))).document;
    const updated = agentQuestionInventory(saved).find(question => question.id === "q1")!.node;
    expect(updated.content[0].content).toEqual([paragraph("opening", "Writing task"), lines]);
    expect(updated.content.slice(1)).toEqual((document.content.content[1] as ChalkLeeQuestionNode).content.slice(1));
    expect(saved.content.content[2]).toEqual(document.content.content[2]);
    const versions = await listDocumentVersions(root, file, await readFile(file));
    expect(versions.versions).toHaveLength(1);
  });
  it("edits group material and subquestion answers independently and clears optional properties/regions", async () => {
    document.content.content = [{ type: "questionGroup", attrs: { id: "group", kind: "reading", number: { mode: "auto" } }, content: [
      { type: "questionMaterial", attrs: { id: "material" }, content: [paragraph("material_p", "原材料")] },
      { type: "subQuestionList", attrs: { id: "children" }, content: [question("child")] }
    ] }];
    await writeFile(file, await createChalkLeeArchive(document));
    const { revision, questions } = await service.readQuestions(file);
    expect(questions[1]).toMatchObject({ id: "child", parentId: "group" });
    await service.updateQuestions(file, revision, [{ questionId: "group", patch: { stem: ["新材料"] } }, { questionId: "child", patch: { answer: [], analysis: ["子题解析"], attrs: { score: null, difficulty: null, tags: [] } } }]);
    const saved = agentQuestionInventory((await readChalkLeeArchive(await readFile(file))).document);
    expect(saved[0].node.content[0]).toMatchObject({ attrs: { id: "material" }, content: [{ content: [{ text: "新材料" }] }] });
    expect(saved[1].node.content.some(region => region.type === "questionAnswer")).toBe(false);
    expect(saved[1].node.attrs).not.toHaveProperty("score");
    expect(saved[1].node.attrs).not.toHaveProperty("difficulty");
    expect(saved[1].node.attrs.tags).toEqual([]);
  });
  it("preserves untouched asset bytes, styles and provenance, and rejects non-ChalkLee/internal targets", async () => {
    const q = document.content.content[1] as ChalkLeeQuestionNode;
    q.content[0].content.push({ type: "image", attrs: { id: "figure", assetId: "asset" } });
    document.provenance!.anchors = [];
    const data = new Uint8Array([0, 1, 255]);
    await writeFile(file, await createChalkLeeArchive(document, [{ id: "asset", path: "assets/figure.png", mediaType: "image/png", data }]));
    const { revision } = await service.readQuestions(file);
    await service.updateQuestions(file, revision, [{ questionId: "q1", patch: { answer: ["B"] } }]);
    const saved = await readChalkLeeArchive(await readFile(file));
    expect(saved.assets.asset).toEqual(data); expect(saved.document.appearance).toEqual(document.appearance); expect(saved.document.provenance).toEqual(document.provenance);
    await writeFile(path.join(root, "原稿.pdf"), "%PDF-test");
    await expect(service.readQuestions("原稿.pdf")).rejects.toThrow("仅支持 ChalkLee");
    await expect(service.updateQuestions("原稿.pdf", revision, [])).rejects.toThrow("仅支持 ChalkLee");
    await expect(service.readQuestions("../outside.chalklee")).rejects.toThrow();
  });
  it("uses live unsaved content, saves it first and commits the agent changes to connected editors", async () => {
    const live = structuredClone(document);
    live.content.content[0] = paragraph("unrelated", "用户未保存的正文");
    const info = await service.info(file);
    const snapshot = { document: live, dirty: true, modifiedAt: info.modifiedAt };
    const release = vi.fn(async () => {}), commit = vi.fn(async () => []);
    const bridge = {
      read: vi.fn(async () => [snapshot]),
      prepare: vi.fn(async () => ({ snapshots: [snapshot], release, commit, assertLease: () => {}, save: async () => { await writeFile(file, await createChalkLeeArchive(live)); } }))
    } as unknown as AgentEditorBridge;
    service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "url", changed, editors: bridge });
    const listing = await service.readQuestions(file);
    expect(listing.source).toBe("editor");
    await service.updateQuestions(file, listing.revision, [{ questionId: "q1", patch: { answer: ["B"] } }]);
    expect((await readChalkLeeArchive(await readFile(file))).document.content.content[0]).toEqual(live.content.content[0]);
    expect(commit).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
  it("edits a clean open document whose editor holds a normalized form of the file, but not one changed on disk meanwhile", async () => {
    const info = await service.info(file);
    // Loading normalizes the content (here an extra default attribute); the clean editor has nothing to save.
    const live = structuredClone(document);
    (live.content.content[0].attrs as Record<string, unknown>).textAlign = "left";
    const snapshot = { document: live, dirty: false, modifiedAt: info.modifiedAt };
    let externalEdit = false;
    const commit = vi.fn(async () => []);
    const bridge = {
      read: vi.fn(async () => [snapshot]),
      prepare: vi.fn(async () => ({ snapshots: [snapshot], release: async () => {}, commit, assertLease: () => {}, save: async () => {
        if (externalEdit) await writeFile(file, await createChalkLeeArchive({ ...document, content: { type: "doc", content: [paragraph("unrelated", "其他程序的修改")] } }));
        return info.modifiedAt;
      } }))
    } as unknown as AgentEditorBridge;
    service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "url", changed, editors: bridge });
    const listing = await service.readQuestions(file);
    await service.updateQuestions(file, listing.revision, [{ questionId: "q1", patch: { answer: ["B"] } }]);
    const saved = (await readChalkLeeArchive(await readFile(file))).document;
    expect(saved.content.content[0].attrs).toMatchObject({ textAlign: "left" });
    expect(agentQuestionInventory(saved).find(question => question.id === "q1")?.text).toContain("B");
    expect(commit).toHaveBeenCalledOnce();
    externalEdit = true;
    snapshot.modifiedAt = (await service.info(file)).modifiedAt;
    await expect(service.updateQuestions(file, undefined, [{ questionId: "q2", patch: { answer: ["C"] } }])).rejects.toThrow("版本已变化");
  });
  it("releases editors without writing if live copies disagree or a save fails", async () => {
    const original = await readFile(file), info = await service.info(file);
    const a = { document, dirty: false, modifiedAt: info.modifiedAt }, b = structuredClone(a);
    b.document.content.content[0] = paragraph("unrelated", "不同正文");
    const release = vi.fn(async () => {}), save = vi.fn(async () => { throw new Error("保存失败"); });
    const prepared = { snapshots: [a, b], release, save, commit: vi.fn() };
    const bridge = { read: async () => prepared.snapshots, prepare: async () => prepared } as unknown as AgentEditorBridge;
    service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "url", changed, editors: bridge });
    await expect(service.updateQuestions(file, await agentDocumentRevision(document), [{ questionId: "q1", patch: { answer: ["B"] } }])).rejects.toThrow("多个编辑器");
    expect(save).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
    prepared.snapshots = [a];
    await expect(service.updateQuestions(file, await agentDocumentRevision(document), [{ questionId: "q1", patch: { answer: ["B"] } }])).rejects.toThrow("保存失败");
    expect(await readFile(file)).toEqual(original); expect(prepared.commit).not.toHaveBeenCalled();
  });
});
