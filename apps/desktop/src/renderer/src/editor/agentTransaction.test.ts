import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo, redo, closeHistory } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { patchAgentQuestions, agentDocumentRevision } from "../../../shared/agent/editing";
import { createQuestionGroupTemplate, createQuestionTemplate, sanitizeChalkLeeEditorJson } from "./editing";
import { projectChalkLeeGroupSolutions } from "./groupSolutionContent";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeAgentAppearanceTransaction, chalkLeeAgentContentTransaction, chalkLeeAgentQuestionTransaction, chalkLeeAgentRunStep, chalkLeeEndsAgentRun, type ChalkLeeAgentRun } from "./agentTransaction";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
describe("agent question editor transactions", () => {
  it("undoes and redoes CSS with paper settings as one edit, retaining user text and stripping runtime attributes", () => {
    const document = createEmptyChalkLeeDocument("设计");
    document.content.content = [{ type: "paragraph", attrs: { id: "body" }, content: [{ type: "text", text: "正文" }] }];
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ ...document.content, attrs: { runtimePage: document.appearance.page } }), plugins: [history()] });
    state = state.apply(state.tr.insertText("用户输入", 1)); const original = state.doc;
    const next = structuredClone(document); next.appearance.design = { css: "p { color: red; }" }; next.appearance.page.marginsPt.top = 42;
    state = state.apply(chalkLeeAgentAppearanceTransaction(state, next)); state = state.apply(closeHistory(state.tr));
    expect(state.doc.attrs.runtimeDesign).toEqual(next.appearance.design); expect(state.doc.textContent).toContain("用户输入");
    expect(JSON.stringify(sanitizeChalkLeeEditorJson(state.doc.toJSON()))).not.toContain("runtimeDesign");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true); expect(state.doc.eq(original)).toBe(true);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true); expect(state.doc.attrs.runtimePage.marginsPt.top).toBe(42);
  });
  it("updates a subquestion's displayed group answer with one independent undo and redo", () => {
    const group = createQuestionGroupTemplate();
    group.attrs!.id = "group";
    const child = group.content!.find(region => region.type === "subQuestionList")!.content![0];
    child.attrs!.id = "child";
    const document = createEmptyChalkLeeDocument("试卷");
    document.content = sanitizeChalkLeeEditorJson({ type: "doc", content: [group, createQuestionTemplate("free-response")] }) as any;
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(projectChalkLeeGroupSolutions(document.content)), plugins: [history()] });
    const original = state.doc;
    const next = patchAgentQuestions(document, [{ questionId: "child", patch: { answer: ["新的子题答案"], attrs: { tags: ["新标签"] } } }]);
    const transaction = chalkLeeAgentQuestionTransaction(state, next, ["child"], nodes => nodes.map(node => projectChalkLeeGroupSolutions(node)));
    state = state.apply(transaction); state = state.apply(closeHistory(state.tr));
    expect(state.doc.textContent).toContain("新的子题答案");
    expect(sanitizeChalkLeeEditorJson(state.doc.toJSON()).content?.[0].content?.find(region => region.type === "subQuestionList")?.content?.[0].attrs?.tags).toEqual(["新标签"]);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.textContent).toContain("新的子题答案");
  });
  it("keeps an unrelated user's edit and selection while applying and undoing a batch", () => {
    const first = createQuestionTemplate("free-response"), second = createQuestionTemplate("free-response");
    first.attrs!.id = "q1"; second.attrs!.id = "q2";
    const document = createEmptyChalkLeeDocument("试卷");
    const paragraph: JSONContent = { type: "paragraph", attrs: { id: "body" }, content: [{ type: "text", text: "正文" }] };
    document.content = sanitizeChalkLeeEditorJson({ type: "doc", content: [paragraph, first, second] }) as any;
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(document.content), plugins: [history()] });
    const userEdit = state.tr.insertText("用户输入", 1);
    state = state.apply(userEdit.setSelection(TextSelection.create(userEdit.doc, 2)));
    const userState = state.doc;
    document.content = sanitizeChalkLeeEditorJson(userState.toJSON()) as any;
    const next = patchAgentQuestions(document, [{ questionId: "q1", patch: { answer: ["A"] } }, { questionId: "q2", patch: { answer: ["B"] } }]);
    state = state.apply(chalkLeeAgentQuestionTransaction(state, next, ["q1", "q2"], nodes => nodes));
    state = state.apply(closeHistory(state.tr));
    expect(state.selection.from).toBe(2);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true); expect(state.doc.eq(userState)).toBe(true);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true); expect(state.doc.textContent).not.toContain("用户输入");
  });
  it("ignores save timestamps and fresh trailing editor rows in revision tokens", async () => {
    const document = createEmptyChalkLeeDocument("文档"), other = structuredClone(document);
    other.metadata.updatedAt = new Date(Date.now() + 1000).toISOString();
    other.content.content.push({ type: "paragraph", attrs: { id: "runtime-tail" } });
    expect(await agentDocumentRevision(other)).toBe(await agentDocumentRevision(document));
    other.metadata.title = "变化";
    expect(await agentDocumentRevision(other)).not.toBe(await agentDocumentRevision(document));
  });
});

describe("one ChalkLee AI run in the open paper", () => {
  const paragraph = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
  function paper() {
    const document = createEmptyChalkLeeDocument("讲义");
    document.content.content = [paragraph("body", "正文") as any];
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(document.content), plugins: [history()] });
    let run: ChalkLeeAgentRun | null = null;
    const current = { state, document };
    const apply = (transaction: ReturnType<EditorState["tr"]["insertText"]>) => {
      if (chalkLeeEndsAgentRun(transaction)) run = null;
      current.state = current.state.apply(transaction);
    };
    const step = (group: string, id: string, text: string) => {
      const next = structuredClone(document);
      next.content = sanitizeChalkLeeEditorJson(current.state.doc.toJSON()) as any;
      next.content.content.push(paragraph(id, text) as any);
      const transaction = chalkLeeAgentContentTransaction(current.state, next, nodes => nodes, run?.group === group);
      const marked = chalkLeeAgentRunStep(transaction, group, run);
      apply(transaction);
      run = marked;
    };
    const undoOnce = () => undo(current.state, tr => { current.state = current.state.apply(tr); });
    return { current, step, apply, undoOnce };
  }

  it("undoes every step of a run at once, and keeps the teacher's typing afterwards as its own step", () => {
    const { current, step, apply, undoOnce } = paper();
    const original = current.state.doc;
    step("run", "a", "第一步");
    step("run", "b", "第二步");
    apply(current.state.tr.insertText("老师", 1));
    expect(undoOnce()).toBe(true);
    expect(current.state.doc.textContent).toBe("正文第一步第二步");
    expect(undoOnce()).toBe(true);
    expect(current.state.doc.eq(original)).toBe(true);
  });

  it("starts a new step when the teacher edits between two steps, and for the next run", () => {
    const { current, step, apply, undoOnce } = paper();
    step("run", "a", "第一步");
    apply(current.state.tr.insertText("老师", 1));
    step("run", "b", "第二步");
    step("next", "c", "下一次");
    undoOnce();
    expect(current.state.doc.textContent).toBe("老师正文第一步第二步");
    undoOnce();
    expect(current.state.doc.textContent).toBe("老师正文第一步");
    undoOnce();
    expect(current.state.doc.textContent).toBe("正文第一步");
  });
});
