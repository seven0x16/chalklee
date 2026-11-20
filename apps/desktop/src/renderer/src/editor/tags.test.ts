import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeRootNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument, createQuestionGroupTemplate, createQuestionTemplate, sanitizeChalkLeeEditorJson } from "./editing";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeQuestionRegionTransaction, findChalkLeeQuestionContext } from "./editorContext";
import { chalkLeeQuestionTagsTransaction, normalizeChalkLeeTags } from "./tags";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
function question(id: string) {
  const node = createQuestionTemplate("single-choice");
  node.attrs = { ...node.attrs, id };
  return node;
}
function setup(content: JSONContent[] = [question("first"), question("second")]) {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }), plugins: [history()] });
}
const tags = (state: EditorState, id: string) => findChalkLeeQuestionContext(state.doc, id)?.node.attrs.tags;

describe("per-question tags", () => {
  it("normalizes pasted tags without splitting spaces inside a label", () => {
    expect(normalizeChalkLeeTags([" 计算题 ", "", "计算题", "七年级 下册"])).toEqual(["计算题", "七年级 下册"]);
    const state = setup();
    const next = state.apply(chalkLeeQuestionTagsTransaction(state, "first", { add: "二元一次方程，计算题;二元一次方程\n易错点； " })!);
    expect(tags(next, "first")).toEqual(["二元一次方程", "计算题", "易错点"]);
  });

  it("edits only the named question while preserving the caret, regions and other attributes", () => {
    let state = setup();
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "second", "optionGroup")!);
    const original = state.doc.firstChild!;
    const tr = chalkLeeQuestionTagsTransaction(state, "first", { add: "易错点" })!;
    expect(tr.selection.eq(state.selection)).toBe(true);
    expect(tr.doc.firstChild!.content.eq(original.content)).toBe(true);
    expect(tr.doc.firstChild!.attrs).toEqual({ ...original.attrs, tags: ["易错点"] });
    expect(tr.doc.lastChild!.eq(state.doc.lastChild!)).toBe(true);
  });

  it("applies a delayed draft to its owner using the latest tags, even when another question is active", () => {
    let state = setup();
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "first", { add: "已有标签" })!);
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "second", "questionStem")!);
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "first", { add: "未回车的标签" })!);
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "first", { remove: "已有标签" })!);
    expect(tags(state, "first")).toEqual(["未回车的标签"]);
    expect(tags(state, "second")).toBeNull();
  });

  it("keeps question-group and nested-question tags independent", () => {
    const group = createQuestionGroupTemplate();
    group.attrs = { ...group.attrs, id: "group" };
    const nested = group.content!.find(node => node.type === "subQuestionList")!.content![0];
    nested.attrs = { ...nested.attrs, id: "nested" };
    let state = setup([group]);
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "group", { add: "阅读材料" })!);
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "nested", { add: "推理" })!);
    expect(tags(state, "group")).toEqual(["阅读材料"]);
    expect(tags(state, "nested")).toEqual(["推理"]);
  });

  it("undoes and redoes tag edits independently of text edits", () => {
    let state = setup();
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "first", "questionStem")!);
    const initial = state.doc;
    state = state.apply(closeHistory(chalkLeeQuestionTagsTransaction(state, "first", { add: "压轴题" })!));
    state = state.apply(closeHistory(state.tr.insertText("新增文字")));
    const edited = state.doc;
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(tags(state, "first")).toEqual(["压轴题"]);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(initial)).toBe(true);
    for (let i = 0; i < 2; i++) expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(edited)).toBe(true);
  });

  it("ignores duplicates and missing owners, follows moved questions and clears the last tag", () => {
    let state = setup();
    expect(chalkLeeQuestionTagsTransaction(state, "missing", { add: "标签" })).toBeNull();
    expect(chalkLeeQuestionTagsTransaction(state, "first", { add: "，； " })).toBeNull();
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "second", { add: "计算题" })!);
    expect(chalkLeeQuestionTagsTransaction(state, "second", { add: "计算题" })).toBeNull();
    state = state.apply(state.tr.delete(0, state.doc.firstChild!.nodeSize));
    expect(chalkLeeQuestionTagsTransaction(state, "first", { add: "已删除" })).toBeNull();
    state = state.apply(chalkLeeQuestionTagsTransaction(state, "second", { remove: "计算题" })!);
    expect(tags(state, "second")).toBeNull();
  });

  it("persists question tags through save and reopen while retaining legacy document metadata", async () => {
    const document = createEmptyChalkLeeDocument("题目标签测试");
    document.metadata = { ...document.metadata, subject: "数学", tags: ["原有文档标签"] };
    const metadata = structuredClone(document.metadata);
    const state = setup();
    document.content = sanitizeChalkLeeEditorJson(state.apply(chalkLeeQuestionTagsTransaction(state, "first", { add: "二元一次方程" })!).doc.toJSON()) as ChalkLeeRootNode;
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document, []));
    expect(archive.document.metadata).toEqual(metadata);
    expect(archive.document.appearance).toEqual(document.appearance);
    const reopened = setup(archive.document.content.content as JSONContent[]);
    expect(tags(reopened, "first")).toEqual(["二元一次方程"]);
    expect(tags(reopened, "second")).toBeNull();
    expect(validateChalkLeeSemantics(archive.document, archive.manifest)).toEqual([]);
  });
});
