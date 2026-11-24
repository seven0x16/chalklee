import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, type ChalkLeeDocument, type ChalkLeeQuestionNode } from "@chalklee/format";
import { AgentWorkspaceService } from "./workspace";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { listDocumentVersions } from "../workspace/versions";
import type { QuestionContentNode } from "../../shared/questionBank/contentEdit";

const paragraph = (id: string, text: string, attrs: Record<string, unknown> = {}) => ({ type: "paragraph" as const, attrs: { id, ...attrs }, content: [{ type: "text" as const, text }] });
function question(id: string, { stem = "原题干", answer = "原答案", score = 2, align }: { stem?: string; answer?: string; score?: number; align?: string } = {}): ChalkLeeQuestionNode {
  return { type: "question", attrs: { id, kind: "choice", number: { mode: "fixed", label: id }, score, tags: [`${id}标签`] }, content: [
    { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, stem, align ? { textAlign: align } : {})] },
    { type: "optionGroup", attrs: { id: `${id}_options`, layout: "two-column" }, content: [
      { type: "option", attrs: { id: `${id}_a`, label: "A" }, content: [paragraph(`${id}_ap`, "选项")] }
    ] },
    { type: "questionAnswer", attrs: { id: `${id}_answer` }, content: [paragraph(`${id}_answerp`, answer)] }
  ] } as ChalkLeeQuestionNode;
}
const withStem = (node: QuestionContentNode, stem: string): QuestionContentNode => {
  const next = structuredClone(node);
  next.content!.find(part => part.type === "questionStem")!.content![0].content = [{ type: "text", text: stem }];
  return next;
};
const withAnswer = (node: QuestionContentNode, answer: string): QuestionContentNode => {
  const next = structuredClone(node);
  next.content!.find(part => part.type === "questionAnswer")!.content![0].content = [{ type: "text", text: answer }];
  return next;
};

let root: string, service: AgentWorkspaceService;
const fileOf = (name: string) => path.join(root, `${name}.chalklee`);
async function write(name: string, ...questions: ChalkLeeQuestionNode[]) {
  const document: ChalkLeeDocument = createEmptyChalkLeeDocument(name);
  document.content.content = questions;
  await writeFile(fileOf(name), await createChalkLeeArchive(document));
}
const saved = async (name: string, id: string) => (await readChalkLeeArchive(await readFile(fileOf(name)))).document.content.content
  .find(node => (node as ChalkLeeQuestionNode).attrs?.id === id) as ChalkLeeQuestionNode;
const textOf = (node: QuestionContentNode | undefined): string => node?.type === "text" ? node.text ?? "" : (node?.content ?? []).map(textOf).join("");
const part = (node: QuestionContentNode, type: string) => textOf(node.content?.find(child => child.type === type));
const at = (name: string, questionId: string) => ({ path: fileOf(name), questionId });

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-question-content-")));
  service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn(), version: { reason: "edit" } });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("editing a question's content from the library", () => {
  it("changes identical copies, keeping each document's number, score, tags and alignment", async () => {
    await write("甲", question("a"));
    await write("乙", question("b", { score: 5, align: "center" }));
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a", [at("甲", "a"), at("乙", "b")]);
    expect(loaded.syncPapers).toBe(2);
    const result = await service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after: withStem(loaded.node, "改好的题干") }, [at("甲", "a"), at("乙", "b")]);
    expect(result).toMatchObject({ different: [], failed: [], error: null });
    expect(result.changes).toHaveLength(2);
    expect(part(await saved("甲", "a"), "questionStem")).toBe("改好的题干");
    const copy = await saved("乙", "b");
    expect(part(copy, "questionStem")).toBe("改好的题干");
    expect(copy.attrs).toMatchObject({ id: "b", score: 5, tags: ["b标签"], number: { mode: "fixed", label: "b" } });
    expect(copy.content[0].content[0]).toMatchObject({ attrs: { id: "b_p", textAlign: "center" } });
    expect((await listDocumentVersions(root, fileOf("乙"), await readFile(fileOf("乙")))).versions).toHaveLength(1);
  });

  it("leaves a copy with different wording untouched and names it", async () => {
    await write("甲", question("a", { stem: "下列说法正确的是" }));
    await write("乙", question("b", { stem: "下列说法不正确的是" }));
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a", [at("甲", "a"), at("乙", "b")]);
    expect(loaded.syncPapers).toBe(1);
    const before = await readFile(fileOf("乙"));
    const result = await service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after: withStem(loaded.node, "下列说法中正确的是") }, [at("甲", "a"), at("乙", "b")]);
    expect(result.different).toEqual(["乙"]);
    expect(result.changes).toHaveLength(1);
    expect((await readFile(fileOf("乙"))).equals(before)).toBe(true);
  });

  it("syncs an edited answer only to copies whose answer read the same", async () => {
    await write("甲", question("a"));
    await write("乙", question("b"));
    await write("丙", question("c", { answer: "更完整的答案" }));
    const copies = [at("甲", "a"), at("乙", "b"), at("丙", "c")];
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a", copies);
    const result = await service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after: withAnswer(withStem(loaded.node, "新题干"), "新答案") }, copies);
    expect(result.different).toEqual(["丙"]);
    expect(part(await saved("乙", "b"), "questionAnswer")).toBe("新答案");
    const third = await saved("丙", "c");
    expect(part(third, "questionStem")).toBe("新题干");
    expect(part(third, "questionAnswer")).toBe("更完整的答案");
  });

  it("keeps a layout-only change in its own document and leaves every copy alone", async () => {
    await write("甲", question("a"));
    await write("乙", question("b"));
    await write("丙", question("c", { stem: "另一种说法" }));
    const copies = [at("甲", "a"), at("乙", "b"), at("丙", "c")];
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a", copies);
    const after = structuredClone(loaded.node);
    after.content!.find(part => part.type === "questionStem")!.content![0].attrs!.textAlign = "center";
    const untouched = await Promise.all(["乙", "丙"].map(name => readFile(fileOf(name))));
    const result = await service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after }, copies);
    expect(result).toMatchObject({ different: [], failed: [], error: null });
    expect(result.changes.map(change => change.path)).toEqual([fileOf("甲")]);
    expect((await saved("甲", "a")).content[0].content[0]).toMatchObject({ attrs: { textAlign: "center" } });
    expect((await readFile(fileOf("乙"))).equals(untouched[0])).toBe(true);
    expect((await readFile(fileOf("丙"))).equals(untouched[1])).toBe(true);
  });

  it("keeps a group's numbers and the links from its blanks to its subquestions in every copy", async () => {
    const group = (id: string, material: string) => ({ type: "questionGroup", attrs: { id, kind: "cloze", number: { mode: "continue" } }, content: [
      { type: "questionMaterial", attrs: { id: `${id}_m` }, content: [{ type: "paragraph", attrs: { id: `${id}_mp` }, content: [{ type: "text", text: material }, { type: "blank", attrs: { id: `${id}_blank`, label: "1", widthPt: 72 } }] }] },
      { type: "subQuestionList", attrs: { id: `${id}_list` }, content: [{ type: "question", attrs: { id: `${id}_s`, kind: "choice", number: { mode: "auto" }, sourceBlankId: `${id}_blank` }, content: [
        { type: "questionStem", attrs: { id: `${id}_ss` }, content: [paragraph(`${id}_sp`, "小题")] }
      ] }] }
    ] }) as unknown as ChalkLeeQuestionNode;
    await write("甲", group("a", "原材料"));
    await write("乙", group("b", "原材料"));
    const copies = [at("甲", "a"), at("乙", "b")];
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a", copies);
    const after = structuredClone(loaded.node);
    after.content![0].content![0].content![0].text = "改好的材料";
    // The card shows subquestions under the numbers the paper gives them.
    after.content![1].content![0].attrs!.number = { mode: "fixed", label: "33" };
    await service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after }, copies);
    for (const [name, id] of [["甲", "a"], ["乙", "b"]]) {
      const node = await saved(name, id) as unknown as QuestionContentNode;
      expect(textOf(node.content![0])).toContain("改好的材料");
      expect(node.attrs!.number).toEqual({ mode: "continue" });
      const sub = node.content![1].content![0];
      expect(sub.attrs).toMatchObject({ id: `${id}_s`, number: { mode: "auto" }, sourceBlankId: `${id}_blank` });
      expect(node.content![0].content![0].content![1].attrs!.id).toBe(`${id}_blank`);
    }
  });

  it("refuses to overwrite a question changed since it was opened", async () => {
    await write("甲", question("a"));
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a");
    await service.updateQuestions(fileOf("甲"), undefined, [{ questionId: "a", patch: { stem: ["别处的修改"] } }]);
    await expect(service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after: withStem(loaded.node, "卡片上的修改") }, [])).rejects.toThrow("已在别处修改");
    expect(part(await saved("甲", "a"), "questionStem")).toBe("别处的修改");
  });

  it("puts back content but keeps a document changed again, and keeps later tag edits", async () => {
    await write("甲", question("a"));
    await write("乙", question("b"));
    const copies = [at("甲", "a"), at("乙", "b")];
    const loaded = await service.readQuestionForEdit(fileOf("甲"), "a", copies);
    const { changes } = await service.saveQuestionContent({ ...at("甲", "a"), before: loaded.node, after: withStem(loaded.node, "新题干") }, copies);
    await service.updateQuestions(fileOf("甲"), undefined, [{ questionId: "a", patch: { attrs: { tags: ["后来的标签"] } } }]);
    await service.updateQuestions(fileOf("乙"), undefined, [{ questionId: "b", patch: { stem: ["之后又改"] } }]);
    expect(await service.restoreQuestionContent(changes[0])).toMatchObject({ kept: false, saved: true });
    expect(await service.restoreQuestionContent(changes[1])).toMatchObject({ kept: true });
    const first = await saved("甲", "a");
    expect(part(first, "questionStem")).toBe("原题干");
    expect(first.attrs.tags).toEqual(["后来的标签"]);
    expect(part(await saved("乙", "b"), "questionStem")).toBe("之后又改");
  });
});
